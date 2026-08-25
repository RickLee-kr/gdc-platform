"""Remote / private Marketplace registry HTTP client (M29.9).

Talks to a machine Registry API. Never executes packages. Acquisition always
flows through existing validate → signature → license → lifecycle install.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import quote, urlencode

import httpx

from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.registry_models import (
    REGISTRY_TYPE_PRIVATE,
    REGISTRY_TYPE_REMOTE_PUBLIC,
    MarketplaceRegistry,
)
from app.connectors_registry.registry_schemas import RegistryPackageSummary
from app.connectors_registry.secure_fetch import (
    SecureFetchError,
    join_registry_url,
    network_policy_from_dict,
    secure_http_get,
)
from app.security.auth_json_crypto import auth_json_for_runtime

# Module-level counter used by tests to assert remote_public OFF ⇒ zero outbound.
_OUTBOUND_REQUEST_COUNT = 0


def reset_outbound_request_count() -> None:
    global _OUTBOUND_REQUEST_COUNT
    _OUTBOUND_REQUEST_COUNT = 0


def outbound_request_count() -> int:
    return _OUTBOUND_REQUEST_COUNT


def _bump_outbound() -> None:
    global _OUTBOUND_REQUEST_COUNT
    _OUTBOUND_REQUEST_COUNT += 1


@dataclass
class RegistryClientHooks:
    """Injectable transport / resolver for tests."""

    transport: httpx.BaseTransport | None = None
    resolver: Callable[[str], list[str]] | None = None
    client_factory: Callable[..., httpx.Client] | None = None


def _policy_dict(row: MarketplaceRegistry) -> dict[str, Any]:
    return dict(row.network_policy or {})


def _auth_headers(row: MarketplaceRegistry) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    secret = row.auth_secret_json
    if not secret:
        return headers
    try:
        material = auth_json_for_runtime(dict(secret))
    except Exception:
        # Fail closed — do not send undecryptable material.
        raise LifecycleError(
            "registry auth secret could not be decrypted",
            error_code="REGISTRY_AUTH_SECRET_INVALID",
            details={"registry_id": row.id},
        )
    token = material.get("bearer_token") or material.get("token") or material.get("api_token")
    if isinstance(token, str) and token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"
    return headers


def assert_registry_network_allowed(row: MarketplaceRegistry) -> None:
    """Block all network calls when registry is disabled / remote_public OFF."""

    if not row.enabled:
        raise LifecycleError(
            f"registry {row.id!r} is disabled; outbound requests are blocked",
            error_code="REGISTRY_DISABLED",
            details={"registry_id": row.id, "registry_type": row.registry_type},
        )
    if row.registry_type == REGISTRY_TYPE_REMOTE_PUBLIC and not row.enabled:
        raise LifecycleError(
            "remote public registry is disabled by default; enable explicitly before network use",
            error_code="REMOTE_REGISTRY_DISABLED",
            details={"registry_id": row.id},
        )


def _fetch_json(
    row: MarketplaceRegistry,
    path_parts: tuple[str, ...],
    *,
    query: Mapping[str, str] | None = None,
    hooks: RegistryClientHooks | None = None,
) -> Any:
    assert_registry_network_allowed(row)
    private = row.registry_type == REGISTRY_TYPE_PRIVATE
    cfg, timeout, max_response, _max_download = network_policy_from_dict(
        _policy_dict(row),
        private_registry=private,
    )
    url = join_registry_url(row.base_url, *path_parts)
    if query:
        url = f"{url}?{urlencode(query)}"

    hooks = hooks or RegistryClientHooks()
    _bump_outbound()
    try:
        result = secure_http_get(
            url,
            config=cfg,
            resolver=hooks.resolver,
            timeout_seconds=timeout,
            max_bytes=max_response,
            headers=_auth_headers(row),
            transport=hooks.transport,
            client_factory=hooks.client_factory,
        )
    except SecureFetchError:
        raise
    except LifecycleError:
        raise

    try:
        return json.loads(result.content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LifecycleError(
            "registry response is not valid JSON",
            error_code="REGISTRY_RESPONSE_INVALID",
            details={"registry_id": row.id, "url": result.final_url},
        ) from exc


def _normalize_package(raw: dict[str, Any], *, row: MarketplaceRegistry) -> RegistryPackageSummary:
    package_id = str(raw.get("package_id") or raw.get("id") or "").strip()
    if not package_id:
        raise LifecycleError(
            "registry package entry missing package_id",
            error_code="REGISTRY_PACKAGE_INVALID",
            details={"registry_id": row.id},
        )
    versions_raw = raw.get("versions") or []
    versions: list[str] = []
    if isinstance(versions_raw, list):
        versions = [str(v).strip() for v in versions_raw if str(v).strip()]
    pack_version = raw.get("pack_version") or raw.get("version")
    if pack_version and str(pack_version) not in versions:
        versions = [str(pack_version), *versions]

    origin = (
        "Private Registry"
        if row.registry_type == REGISTRY_TYPE_PRIVATE
        else "Remote Registry"
    )
    return RegistryPackageSummary(
        package_id=package_id,
        name=raw.get("name"),
        vendor=raw.get("vendor"),
        pack_version=str(pack_version) if pack_version else (versions[0] if versions else None),
        description=raw.get("description"),
        package_kind=raw.get("package_kind") or raw.get("kind"),
        versions=versions,
        declared_trust_tier=raw.get("trust_tier") or raw.get("declared_trust_tier"),
        registry_id=row.id,
        registry_name=row.name,
        registry_type=row.registry_type,
        origin=origin,
    )


def list_catalog(
    row: MarketplaceRegistry,
    *,
    hooks: RegistryClientHooks | None = None,
) -> list[RegistryPackageSummary]:
    """GET ``/v1/catalog`` (or ``/catalog``) package list."""

    if not row.enabled_for_browse:
        raise LifecycleError(
            f"registry {row.id!r} is not enabled for browse",
            error_code="REGISTRY_BROWSE_DISABLED",
            details={"registry_id": row.id},
        )
    raw: Any
    try:
        raw = _fetch_json(row, ("v1", "catalog"), hooks=hooks)
    except SecureFetchError as first:
        # Fallback path for simpler registry stubs.
        try:
            raw = _fetch_json(row, ("catalog",), hooks=hooks)
        except Exception:
            raise first from first

    packages_raw = raw.get("packages") if isinstance(raw, dict) else raw
    if not isinstance(packages_raw, list):
        raise LifecycleError(
            "registry catalog response missing packages list",
            error_code="REGISTRY_CATALOG_INVALID",
            details={"registry_id": row.id},
        )
    return [
        _normalize_package(item, row=row)
        for item in packages_raw
        if isinstance(item, dict)
    ]


def search_catalog(
    row: MarketplaceRegistry,
    query: str,
    *,
    hooks: RegistryClientHooks | None = None,
) -> list[RegistryPackageSummary]:
    if not row.enabled_for_browse:
        raise LifecycleError(
            f"registry {row.id!r} is not enabled for browse",
            error_code="REGISTRY_BROWSE_DISABLED",
            details={"registry_id": row.id},
        )
    q = (query or "").strip()
    try:
        raw = _fetch_json(row, ("v1", "search"), query={"q": q}, hooks=hooks)
    except SecureFetchError:
        raw = _fetch_json(row, ("search",), query={"q": q}, hooks=hooks)

    packages_raw = raw.get("packages") if isinstance(raw, dict) else raw
    if not isinstance(packages_raw, list):
        # Client-side filter fallback when registry has catalog only.
        catalog = list_catalog(row, hooks=hooks)
        needle = q.lower()
        return [
            p
            for p in catalog
            if needle in (p.package_id or "").lower()
            or needle in (p.name or "").lower()
            or needle in (p.vendor or "").lower()
        ]
    return [
        _normalize_package(item, row=row)
        for item in packages_raw
        if isinstance(item, dict)
    ]


def get_package_metadata(
    row: MarketplaceRegistry,
    package_id: str,
    *,
    hooks: RegistryClientHooks | None = None,
) -> RegistryPackageSummary:
    if not row.enabled_for_browse:
        raise LifecycleError(
            f"registry {row.id!r} is not enabled for browse",
            error_code="REGISTRY_BROWSE_DISABLED",
            details={"registry_id": row.id},
        )
    pid = quote(package_id.strip(), safe="")
    try:
        raw = _fetch_json(row, ("v1", "packages", pid), hooks=hooks)
    except SecureFetchError:
        raw = _fetch_json(row, ("packages", pid), hooks=hooks)
    if not isinstance(raw, dict):
        raise LifecycleError(
            "registry package metadata response invalid",
            error_code="REGISTRY_PACKAGE_INVALID",
            details={"registry_id": row.id, "package_id": package_id},
        )
    return _normalize_package(raw, row=row)


def list_versions(
    row: MarketplaceRegistry,
    package_id: str,
    *,
    hooks: RegistryClientHooks | None = None,
) -> list[str]:
    meta = get_package_metadata(row, package_id, hooks=hooks)
    if meta.versions:
        return list(meta.versions)
    pid = quote(package_id.strip(), safe="")
    try:
        raw = _fetch_json(row, ("v1", "packages", pid, "versions"), hooks=hooks)
    except SecureFetchError:
        return []
    versions_raw = raw.get("versions") if isinstance(raw, dict) else raw
    if not isinstance(versions_raw, list):
        return []
    return [str(v).strip() for v in versions_raw if str(v).strip()]


def acquire_package_archive(
    row: MarketplaceRegistry,
    package_id: str,
    *,
    pack_version: str | None = None,
    hooks: RegistryClientHooks | None = None,
) -> bytes:
    """Download package ``.tar.gz`` bytes. Does not install or execute."""

    assert_registry_network_allowed(row)
    if not row.enabled_for_install:
        raise LifecycleError(
            f"registry {row.id!r} is not enabled for install",
            error_code="REGISTRY_INSTALL_DISABLED",
            details={"registry_id": row.id},
        )

    private = row.registry_type == REGISTRY_TYPE_PRIVATE
    cfg, timeout, _max_response, max_download = network_policy_from_dict(
        _policy_dict(row),
        private_registry=private,
    )

    pid = quote(package_id.strip(), safe="")
    version = (pack_version or "").strip()
    if version:
        candidates = [
            ("v1", "packages", pid, "versions", quote(version, safe=""), "download"),
            ("packages", pid, "versions", quote(version, safe=""), "download"),
        ]
    else:
        candidates = [
            ("v1", "packages", pid, "download"),
            ("packages", pid, "download"),
        ]

    hooks = hooks or RegistryClientHooks()
    last_error: Exception | None = None
    for parts in candidates:
        url = join_registry_url(row.base_url, *parts)
        _bump_outbound()
        try:
            result = secure_http_get(
                url,
                config=cfg,
                resolver=hooks.resolver,
                timeout_seconds=timeout,
                max_bytes=max_download,
                headers=_auth_headers(row),
                transport=hooks.transport,
                client_factory=hooks.client_factory,
            )
            return result.content
        except (SecureFetchError, LifecycleError) as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise LifecycleError(
        f"package acquire failed for {package_id!r}",
        error_code="REGISTRY_ACQUIRE_FAILED",
        details={"registry_id": row.id, "package_id": package_id},
    )


def test_connection(
    row: MarketplaceRegistry,
    *,
    hooks: RegistryClientHooks | None = None,
) -> tuple[bool, str, dict[str, Any]]:
    """Probe registry connectivity via catalog endpoint (no install)."""

    import time

    started = time.perf_counter()
    try:
        packages = list_catalog(row, hooks=hooks)
    except LifecycleError as exc:
        return False, exc.message, {"error_code": exc.error_code, **exc.details}
    except SecureFetchError as exc:
        return False, exc.message, {"error_code": exc.error_code, **exc.details}
    latency_ms = (time.perf_counter() - started) * 1000.0
    return True, f"connected; catalog returned {len(packages)} package(s)", {
        "package_count": len(packages),
        "latency_ms": latency_ms,
        "registry_type": row.registry_type,
    }


def origin_label_for_registry_type(registry_type: str) -> str:
    if registry_type == REGISTRY_TYPE_PRIVATE:
        return "Private Registry"
    if registry_type == REGISTRY_TYPE_REMOTE_PUBLIC:
        return "Remote Registry"
    return "Remote Registry"
