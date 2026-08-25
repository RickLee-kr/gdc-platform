"""Marketplace remote/private registry administration service (M29.9)."""

from __future__ import annotations

import secrets
import time
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.connectors_registry.acquisition_url_policy import (
    AcquisitionUrlPolicyError,
    NetworkAcquisitionPolicyConfig,
    validate_url,
)
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_models import (
    LIFECYCLE_ORIGIN_PRIVATE_REGISTRY,
    LIFECYCLE_ORIGIN_REMOTE_REGISTRY,
    LIFECYCLE_STATUS_INSTALLED,
    MarketplacePackageInstall,
)
from app.connectors_registry.lifecycle_service import install_package
from app.connectors_registry.registry_client import (
    RegistryClientHooks,
    acquire_package_archive,
    get_package_metadata,
    list_catalog,
    origin_label_for_registry_type,
    search_catalog,
    test_connection,
)
from app.connectors_registry.registry_models import (
    REGISTRY_TYPE_PRIVATE,
    REGISTRY_TYPE_REMOTE_PUBLIC,
    REMOTE_PUBLIC_DEFAULT_ENABLED,
    MarketplaceRegistry,
)
from app.connectors_registry.registry_schemas import (
    MarketplaceRegistryConnectionTestResult,
    MarketplaceRegistryCreate,
    MarketplaceRegistryListResponse,
    MarketplaceRegistryRead,
    MarketplaceRegistryUpdate,
    RegistryCatalogResponse,
    RegistryPackageSummary,
)
from app.database import utcnow
from app.security.auth_json_crypto import auth_json_for_storage


def _new_registry_id() -> str:
    return f"reg_{secrets.token_hex(8)}"


def _as_dict(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return dict(value.model_dump())
    if isinstance(value, dict):
        return dict(value)
    return None


def _validate_base_url_for_type(
    base_url: str,
    *,
    registry_type: str,
    network_policy: dict[str, Any] | None,
) -> None:
    """Structural URL validation (no network I/O) at configuration time."""

    policy = dict(network_policy or {})
    hosts_raw = policy.get("allowed_hosts") or []
    hosts = frozenset(str(h).strip() for h in hosts_raw if str(h).strip())
    allow_http = bool(policy.get("allow_http", False))
    allow_private = bool(policy.get("allow_private_networks", False)) and bool(hosts)
    if registry_type != REGISTRY_TYPE_PRIVATE:
        allow_private = False

    cfg = NetworkAcquisitionPolicyConfig(
        allowed_hosts=hosts if hosts else frozenset(),
        allow_http=allow_http,
        allow_private_for_allowlisted_hosts=allow_private,
    )
    # When allowlist is empty, do not force host allowlist at config time —
    # IP safety still applies on actual fetch.
    try:
        if hosts:
            validate_url(base_url, config=cfg)
        else:
            # Validate scheme/host shape without requiring allowlist membership.
            validate_url(
                base_url,
                config=NetworkAcquisitionPolicyConfig(
                    allow_http=allow_http,
                    allow_private_for_allowlisted_hosts=False,
                ),
            )
    except AcquisitionUrlPolicyError as exc:
        # Private registries may register internal hostnames before DNS is
        # resolvable; only reject clearly unsafe literals (localhost / IP).
        if registry_type == REGISTRY_TYPE_PRIVATE and exc.code in {
            "PRIVATE_IP_BLOCKED",
            "HOST_NOT_ALLOWED",
        }:
            if not hosts and exc.code == "PRIVATE_IP_BLOCKED":
                raise LifecycleError(
                    (
                        "private registry base_url resolves to a private IP but no "
                        "host allowlist is configured; set network_policy.allowed_hosts "
                        "and allow_private_networks=true"
                    ),
                    error_code="REGISTRY_NETWORK_POLICY_REQUIRED",
                    details={"policy_code": exc.code, "base_url": base_url},
                ) from exc
            if hosts and exc.code == "PRIVATE_IP_BLOCKED":
                # Allowlisted private IP literal is OK when allow_private is set.
                if allow_private:
                    return
            if hosts and exc.code == "HOST_NOT_ALLOWED":
                raise LifecycleError(
                    exc.message,
                    error_code="REGISTRY_BASE_URL_BLOCKED",
                    details={"policy_code": exc.code},
                ) from exc
        if exc.code in {
            "LOCALHOST_BLOCKED",
            "LOOPBACK_BLOCKED",
            "LINK_LOCAL_BLOCKED",
            "METADATA_IP_BLOCKED",
            "METADATA_HOST_BLOCKED",
            "UNSUPPORTED_SCHEME",
            "HTTP_BLOCKED",
            "USERINFO_BLOCKED",
            "MALFORMED_URL",
            "MALFORMED_HOSTNAME",
        }:
            raise LifecycleError(
                exc.message,
                error_code="REGISTRY_BASE_URL_BLOCKED",
                details={"policy_code": exc.code},
            ) from exc
        # Non-literal hostnames that fail DNS-less private checks are fine at create.
        parsed = urlparse(base_url)
        host = (parsed.hostname or "").lower()
        if host in {"localhost"} or host.endswith(".localhost"):
            raise LifecycleError(
                exc.message,
                error_code="REGISTRY_BASE_URL_BLOCKED",
                details={"policy_code": exc.code},
            ) from exc


def _row_to_read(row: MarketplaceRegistry) -> MarketplaceRegistryRead:
    return MarketplaceRegistryRead(
        id=row.id,
        name=row.name,
        registry_type=row.registry_type,
        base_url=row.base_url,
        enabled=bool(row.enabled),
        enabled_for_browse=bool(row.enabled_for_browse),
        enabled_for_install=bool(row.enabled_for_install),
        authentication_reference=row.authentication_reference,
        has_auth_secret=bool(row.auth_secret_json),
        trusted_key_policy=dict(row.trusted_key_policy) if row.trusted_key_policy else None,
        network_policy=dict(row.network_policy) if row.network_policy else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _encrypt_bearer(token: str | None) -> dict[str, Any] | None:
    if token is None:
        return None
    text = token.strip()
    if not text:
        return None
    return auth_json_for_storage({"bearer_token": text})


def list_registries(db: Session) -> MarketplaceRegistryListResponse:
    rows = db.query(MarketplaceRegistry).order_by(MarketplaceRegistry.name.asc()).all()
    return MarketplaceRegistryListResponse(
        registries=[_row_to_read(r) for r in rows],
        count=len(rows),
        remote_public_default_enabled=REMOTE_PUBLIC_DEFAULT_ENABLED,
    )


def get_registry(db: Session, registry_id: str) -> MarketplaceRegistry:
    row = db.query(MarketplaceRegistry).filter(MarketplaceRegistry.id == registry_id).first()
    if row is None:
        raise LifecycleError(
            f"registry not found: {registry_id}",
            error_code="REGISTRY_NOT_FOUND",
            details={"registry_id": registry_id},
        )
    return row


def get_registry_read(db: Session, registry_id: str) -> MarketplaceRegistryRead:
    return _row_to_read(get_registry(db, registry_id))


def create_registry(db: Session, payload: MarketplaceRegistryCreate) -> MarketplaceRegistryRead:
    network_policy = _as_dict(payload.network_policy)
    _validate_base_url_for_type(
        payload.base_url,
        registry_type=payload.registry_type,
        network_policy=network_policy,
    )

    if payload.enabled is None:
        # remote_public defaults OFF; private defaults enabled when created.
        enabled = (
            REMOTE_PUBLIC_DEFAULT_ENABLED
            if payload.registry_type == REGISTRY_TYPE_REMOTE_PUBLIC
            else True
        )
    else:
        enabled = bool(payload.enabled)
        if payload.registry_type == REGISTRY_TYPE_REMOTE_PUBLIC and enabled and not REMOTE_PUBLIC_DEFAULT_ENABLED:
            # Explicit admin enable is allowed — keep enabled=True.
            pass

    # Reject plaintext secret fields accidentally placed into network/trusted policy.
    for blob_name, blob in (("network_policy", network_policy), ("trusted_key_policy", _as_dict(payload.trusted_key_policy))):
        if not blob:
            continue
        for key in ("token", "bearer_token", "password", "api_key", "secret"):
            if key in blob and blob[key]:
                raise LifecycleError(
                    f"plaintext secret field {key!r} is not allowed in {blob_name}",
                    error_code="PLAINTEXT_REGISTRY_SECRET_FORBIDDEN",
                    details={"field": key, "container": blob_name},
                )

    now = utcnow()
    row = MarketplaceRegistry(
        id=_new_registry_id(),
        name=payload.name,
        registry_type=payload.registry_type,
        base_url=payload.base_url.rstrip("/"),
        enabled=enabled,
        enabled_for_browse=bool(payload.enabled_for_browse),
        enabled_for_install=bool(payload.enabled_for_install),
        authentication_reference=(payload.authentication_reference or None),
        auth_secret_json=_encrypt_bearer(payload.bearer_token),
        trusted_key_policy=_as_dict(payload.trusted_key_policy),
        network_policy=network_policy,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_read(row)


def update_registry(
    db: Session,
    registry_id: str,
    payload: MarketplaceRegistryUpdate,
) -> MarketplaceRegistryRead:
    row = get_registry(db, registry_id)
    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip()
        if not name:
            raise LifecycleError("name is required", error_code="REGISTRY_INVALID")
        row.name = name
    if "base_url" in data and data["base_url"] is not None:
        base_url = str(data["base_url"]).strip().rstrip("/")
        network_policy = (
            _as_dict(payload.network_policy)
            if "network_policy" in data
            else (dict(row.network_policy) if row.network_policy else None)
        )
        _validate_base_url_for_type(
            base_url,
            registry_type=row.registry_type,
            network_policy=network_policy,
        )
        row.base_url = base_url
    if "enabled" in data and data["enabled"] is not None:
        row.enabled = bool(data["enabled"])
    if "enabled_for_browse" in data and data["enabled_for_browse"] is not None:
        row.enabled_for_browse = bool(data["enabled_for_browse"])
    if "enabled_for_install" in data and data["enabled_for_install"] is not None:
        row.enabled_for_install = bool(data["enabled_for_install"])
    if "authentication_reference" in data:
        ref = data["authentication_reference"]
        row.authentication_reference = str(ref).strip() if ref else None
    if data.get("clear_auth_secret"):
        row.auth_secret_json = None
    if "bearer_token" in data and data["bearer_token"] is not None:
        row.auth_secret_json = _encrypt_bearer(str(data["bearer_token"]))
    if "trusted_key_policy" in data:
        row.trusted_key_policy = _as_dict(payload.trusted_key_policy)
    if "network_policy" in data:
        row.network_policy = _as_dict(payload.network_policy)

    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return _row_to_read(row)


def disable_registry(db: Session, registry_id: str) -> MarketplaceRegistryRead:
    return update_registry(
        db,
        registry_id,
        MarketplaceRegistryUpdate(enabled=False),
    )


def delete_registry(db: Session, registry_id: str) -> MarketplaceRegistryRead:
    """Delete registry configuration. Does NOT uninstall packages.

    Packages installed from this registry remain installed; only the registry
    configuration row is removed.
    """

    row = get_registry(db, registry_id)
    read = _row_to_read(row)
    # Count installed packages that originated from registries — informational only.
    # We intentionally do not auto-uninstall.
    db.delete(row)
    db.commit()
    return read


def registry_has_installed_packages(db: Session, registry_id: str) -> int:
    """Informational: count installs with registry origins (not tied by FK)."""

    origins = (LIFECYCLE_ORIGIN_PRIVATE_REGISTRY, LIFECYCLE_ORIGIN_REMOTE_REGISTRY)
    return (
        db.query(MarketplacePackageInstall)
        .filter(
            MarketplacePackageInstall.status == LIFECYCLE_STATUS_INSTALLED,
            MarketplacePackageInstall.origin.in_(origins),
        )
        .count()
    )


def test_registry_connection(
    db: Session,
    registry_id: str,
    *,
    hooks: RegistryClientHooks | None = None,
) -> MarketplaceRegistryConnectionTestResult:
    row = get_registry(db, registry_id)
    if not row.enabled:
        return MarketplaceRegistryConnectionTestResult(
            status="FAIL",
            registry_id=row.id,
            message="registry is disabled; enable before testing connection",
            error_code="REGISTRY_DISABLED",
        )
    started = time.perf_counter()
    ok, message, details = test_connection(row, hooks=hooks)
    latency = (time.perf_counter() - started) * 1000.0
    return MarketplaceRegistryConnectionTestResult(
        status="PASS" if ok else "FAIL",
        registry_id=row.id,
        message=message,
        latency_ms=float(details.get("latency_ms") or latency),
        error_code=None if ok else str(details.get("error_code") or "REGISTRY_UNAVAILABLE"),
        details=details,
    )


def browse_registry_packages(
    db: Session,
    registry_id: str,
    *,
    q: str | None = None,
    hooks: RegistryClientHooks | None = None,
) -> RegistryCatalogResponse:
    row = get_registry(db, registry_id)
    if not row.enabled:
        return RegistryCatalogResponse(
            packages=[],
            count=0,
            registry_id=row.id,
            unavailable=True,
            unavailable_reason="Registry is disabled.",
            error_code="REGISTRY_DISABLED",
        )
    try:
        packages = search_catalog(row, q, hooks=hooks) if q else list_catalog(row, hooks=hooks)
    except LifecycleError as exc:
        return RegistryCatalogResponse(
            packages=[],
            count=0,
            registry_id=row.id,
            unavailable=True,
            unavailable_reason=exc.message,
            error_code=exc.error_code,
        )
    return RegistryCatalogResponse(
        packages=packages,
        count=len(packages),
        registry_id=row.id,
        unavailable=False,
    )


def browse_all_enabled_registries(
    db: Session,
    *,
    q: str | None = None,
    hooks: RegistryClientHooks | None = None,
) -> RegistryCatalogResponse:
    """Aggregate catalog entries from all enabled registries (browse)."""

    rows = (
        db.query(MarketplaceRegistry)
        .filter(
            MarketplaceRegistry.enabled.is_(True),
            MarketplaceRegistry.enabled_for_browse.is_(True),
        )
        .order_by(MarketplaceRegistry.name.asc())
        .all()
    )
    packages: list[RegistryPackageSummary] = []
    errors: list[str] = []
    for row in rows:
        try:
            found = search_catalog(row, q, hooks=hooks) if q else list_catalog(row, hooks=hooks)
            packages.extend(found)
        except LifecycleError as exc:
            errors.append(f"{row.name}: {exc.message}")
    unavailable = not packages and bool(errors) and bool(rows)
    return RegistryCatalogResponse(
        packages=packages,
        count=len(packages),
        unavailable=unavailable,
        unavailable_reason="; ".join(errors) if errors else None,
        error_code="REGISTRY_UNAVAILABLE" if unavailable else None,
    )


def acquire_and_install_from_registry(
    db: Session,
    registry_id: str,
    package_id: str,
    *,
    pack_version: str | None = None,
    actor_role: str,
    hooks: RegistryClientHooks | None = None,
    builtin_root: Any = None,
    installed_root: Any = None,
) -> Any:
    """Acquire archive from registry then install via existing lifecycle."""

    from app.connectors_registry.lifecycle_models import (
        LIFECYCLE_ORIGIN_PRIVATE_REGISTRY,
        LIFECYCLE_ORIGIN_REMOTE_REGISTRY,
    )

    row = get_registry(db, registry_id)
    if not row.enabled:
        raise LifecycleError(
            f"registry {registry_id!r} is disabled",
            error_code="REGISTRY_DISABLED",
        )
    if not row.enabled_for_install:
        raise LifecycleError(
            f"registry {registry_id!r} is not enabled for install",
            error_code="REGISTRY_INSTALL_DISABLED",
        )

    # Optional metadata fetch (browse) — ignore declared trust claims.
    try:
        meta = get_package_metadata(row, package_id, hooks=hooks)
        _ = meta.declared_trust_tier  # explicitly ignored for platform trust
    except LifecycleError:
        meta = None

    archive = acquire_package_archive(
        row,
        package_id,
        pack_version=pack_version or (meta.pack_version if meta else None),
        hooks=hooks,
    )
    origin = (
        LIFECYCLE_ORIGIN_PRIVATE_REGISTRY
        if row.registry_type == REGISTRY_TYPE_PRIVATE
        else LIFECYCLE_ORIGIN_REMOTE_REGISTRY
    )
    return install_package(
        db,
        archive,
        actor_role=actor_role,
        origin=origin,
        require_valid_signature=bool((row.trusted_key_policy or {}).get("require_signature")),
        enforce_license_deny=True,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )


__all__ = [
    "acquire_and_install_from_registry",
    "browse_all_enabled_registries",
    "browse_registry_packages",
    "create_registry",
    "delete_registry",
    "disable_registry",
    "get_registry",
    "get_registry_read",
    "list_registries",
    "origin_label_for_registry_type",
    "registry_has_installed_packages",
    "test_registry_connection",
    "update_registry",
]
