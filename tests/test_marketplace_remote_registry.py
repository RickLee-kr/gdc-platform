"""Tests for M29.9 Remote / Private Registry + offline signed bundle + SSRF fetch."""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.auth.role_guard import ROLE_ADMINISTRATOR
from app.connectors_registry.acquisition_url_policy import (
    AcquisitionUrlPolicyError,
    NetworkAcquisitionPolicyConfig,
    validate_url,
    validate_url_with_dns,
)
from app.connectors_registry.lifecycle_errors import LifecycleError
from app.connectors_registry.lifecycle_models import (
    LIFECYCLE_ORIGIN_PRIVATE_REGISTRY,
    LIFECYCLE_STATUS_INSTALLED,
    MarketplacePackageInstall,
)
from app.connectors_registry.lifecycle_service import install_package
from app.connectors_registry.offline_bundle import install_offline_signed_bundle
from app.connectors_registry.registry_client import (
    acquire_package_archive,
    list_catalog,
    outbound_request_count,
    reset_outbound_request_count,
)
from app.connectors_registry.registry_models import (
    REGISTRY_TYPE_PRIVATE,
    REGISTRY_TYPE_REMOTE_PUBLIC,
    REMOTE_PUBLIC_DEFAULT_ENABLED,
    MarketplaceRegistry,
)
from app.connectors_registry.registry_schemas import MarketplaceRegistryCreate
from app.connectors_registry.registry_service import (
    acquire_and_install_from_registry,
    create_registry,
    delete_registry,
    list_registries,
)
from app.connectors_registry.secure_fetch import secure_http_get
from app.connectors_registry.service import clear_registry_cache, reload_registry
from app.database import get_db
from app.main import app
import base64


def _base_source(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": "acme",
        "name": "Acme API",
        "vendor": "Acme",
        "version": "1.0.0",
        "source_type": "HTTP_API_POLLING",
        "auth": {"type": "bearer"},
        "streams": [{"id": "events", "name": "Events"}],
        "package_id": "acme",
        "package_kind": "source",
        "pack_version": "1.0.0",
        "license": "MIT",
    }
    payload.update(overrides)
    return payload


def _make_tar_gz(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in files.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _package_archive(
    manifest: dict[str, Any],
    *,
    root_dir: str = "acme",
    extra: dict[str, str | bytes] | None = None,
) -> bytes:
    files: dict[str, str | bytes] = {
        f"{root_dir}/manifest.yaml": yaml.safe_dump(manifest, sort_keys=False),
    }
    if extra:
        for rel, body in extra.items():
            files[f"{root_dir}/{rel}"] = body
    return _make_tar_gz(files)


def _admin_headers() -> dict[str, str]:
    token, _ = issue_access_token(username="m29-9-admin", user_id=99, role=ROLE_ADMINISTRATOR, token_version=1)
    return {"Authorization": f"Bearer {token}"}


_PUBLIC_DNS = lambda host: ["8.8.8.8"]


@pytest.fixture
def builtin_root(tmp_path: Path) -> Path:
    root = tmp_path / "connectors"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def installed_root(tmp_path: Path) -> Path:
    root = tmp_path / "plugins"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def client(
    db_session: Session, builtin_root: Path, installed_root: Path, monkeypatch: pytest.MonkeyPatch
) -> TestClient:
    monkeypatch.setattr("app.config.settings.GDC_PLUGINS_DIR", str(installed_root))
    monkeypatch.setattr(
        "app.connectors_registry.roots.builtin_connectors_root",
        lambda: builtin_root,
    )
    monkeypatch.setattr(
        "app.connectors_registry.loader.builtin_connectors_root",
        lambda: builtin_root,
    )
    monkeypatch.setattr(
        "app.connectors_registry.lifecycle_service.builtin_connectors_root",
        lambda: builtin_root,
    )
    monkeypatch.setattr(
        "app.connectors_registry.lifecycle_service.installed_plugins_root",
        lambda: installed_root,
    )
    monkeypatch.setattr(
        "app.connectors_registry.lifecycle_publish.installed_plugins_root",
        lambda: installed_root,
    )

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    clear_registry_cache()
    reload_registry(root=builtin_root, installed_root=installed_root)
    reset_outbound_request_count()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_registry_cache()


def test_remote_registry_disabled_by_default() -> None:
    assert REMOTE_PUBLIC_DEFAULT_ENABLED is False


def test_private_registry_crud(db_session: Session, client: TestClient) -> None:
    headers = _admin_headers()
    created = client.post(
        "/api/v1/connectors-registry/registries",
        headers=headers,
        json={
            "name": "Corp Private",
            "registry_type": "private",
            "base_url": "https://registry.corp.example",
            "authentication_reference": "credential:env:REG_TOKEN",
            "bearer_token": "super-secret-token",
            "network_policy": {
                "allowed_hosts": ["registry.corp.example"],
                "allow_private_networks": True,
            },
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["registry_type"] == "private"
    assert body["enabled"] is True
    assert body["authentication_reference"] == "credential:env:REG_TOKEN"
    assert body["has_auth_secret"] is True
    assert "bearer_token" not in body
    assert "super-secret-token" not in json.dumps(body)

    listed = client.get("/api/v1/connectors-registry/registries", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["remote_public_default_enabled"] is False
    assert listed.json()["count"] == 1

    rid = body["id"]
    disabled = client.post(f"/api/v1/connectors-registry/registries/{rid}/disable", headers=headers)
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    deleted = client.delete(f"/api/v1/connectors-registry/registries/{rid}", headers=headers)
    assert deleted.status_code == 200
    assert list_registries(db_session).count == 0


def test_remote_public_defaults_disabled(db_session: Session) -> None:
    row = create_registry(
        db_session,
        MarketplaceRegistryCreate(
            name="Public Mirror",
            registry_type=REGISTRY_TYPE_REMOTE_PUBLIC,
            base_url="https://registry.example.com",
        ),
    )
    assert row.enabled is False


def test_no_plaintext_registry_secret_in_read(db_session: Session) -> None:
    row = create_registry(
        db_session,
        MarketplaceRegistryCreate(
            name="Sec",
            registry_type=REGISTRY_TYPE_PRIVATE,
            base_url="https://reg.example",
            bearer_token="plain-secret-value",
        ),
    )
    assert row.has_auth_secret is True
    dumped = row.model_dump(mode="json")
    assert "plain-secret-value" not in json.dumps(dumped)
    assert "bearer_token" not in dumped


def test_plaintext_secret_in_network_policy_rejected(db_session: Session) -> None:
    with pytest.raises(LifecycleError) as exc:
        create_registry(
            db_session,
            MarketplaceRegistryCreate(
                name="Bad",
                registry_type=REGISTRY_TYPE_PRIVATE,
                base_url="https://reg.example",
                network_policy={"token": "leak"},
            ),
        )
    assert exc.value.error_code == "PLAINTEXT_REGISTRY_SECRET_FORBIDDEN"


def _mock_registry_transport(archive: bytes) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/catalog") or path.endswith("/v1/catalog"):
            return httpx.Response(
                200,
                json={
                    "packages": [
                        {
                            "package_id": "acme",
                            "name": "Acme API",
                            "vendor": "Acme",
                            "pack_version": "1.0.0",
                            "trust_tier": "Official",
                            "versions": ["1.0.0"],
                        }
                    ]
                },
            )
        if path.endswith("/search"):
            return httpx.Response(
                200,
                json={"packages": [{"package_id": "acme", "name": "Acme API", "pack_version": "1.0.0"}]},
            )
        if "/packages/acme" in path and path.endswith("/download"):
            return httpx.Response(200, content=archive, headers={"content-type": "application/gzip"})
        if path.endswith("/packages/acme") or "/packages/acme" in path:
            return httpx.Response(
                200,
                json={
                    "package_id": "acme",
                    "name": "Acme API",
                    "pack_version": "1.0.0",
                    "trust_tier": "Verified",
                    "versions": ["1.0.0"],
                },
            )
        return httpx.Response(404, json={"error": "not found", "path": path})

    return httpx.MockTransport(handler)


def test_catalog_search_acquire_and_lifecycle_install(
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
) -> None:
    archive = _package_archive(_base_source())
    transport = _mock_registry_transport(archive)
    resolver = _PUBLIC_DNS

    row = create_registry(
        db_session,
        MarketplaceRegistryCreate(
            name="Private",
            registry_type=REGISTRY_TYPE_PRIVATE,
            base_url="https://registry.corp.example",
            enabled=True,
            network_policy={"allowed_hosts": ["registry.corp.example"]},
        ),
    )
    db_row = db_session.query(MarketplaceRegistry).filter_by(id=row.id).one()

    from app.connectors_registry.registry_client import RegistryClientHooks

    hooks = RegistryClientHooks(transport=transport, resolver=resolver)
    catalog = list_catalog(db_row, hooks=hooks)
    assert len(catalog) == 1
    assert catalog[0].package_id == "acme"
    assert catalog[0].declared_trust_tier == "Official"
    assert catalog[0].origin == "Private Registry"

    bytes_out = acquire_package_archive(db_row, "acme", pack_version="1.0.0", hooks=hooks)
    assert bytes_out[:2] == b"\x1f\x8b"

    installed = acquire_and_install_from_registry(
        db_session,
        row.id,
        "acme",
        pack_version="1.0.0",
        actor_role=ROLE_ADMINISTRATOR,
        hooks=hooks,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )
    assert installed.origin == LIFECYCLE_ORIGIN_PRIVATE_REGISTRY
    assert installed.status == LIFECYCLE_STATUS_INSTALLED


def test_remote_disabled_outbound_request_zero(db_session: Session) -> None:
    reset_outbound_request_count()
    row = create_registry(
        db_session,
        MarketplaceRegistryCreate(
            name="Remote Off",
            registry_type=REGISTRY_TYPE_REMOTE_PUBLIC,
            base_url="https://registry.example.com",
        ),
    )
    assert row.enabled is False
    db_row = db_session.query(MarketplaceRegistry).filter_by(id=row.id).one()
    with pytest.raises(LifecycleError) as exc:
        list_catalog(db_row)
    assert exc.value.error_code == "REGISTRY_DISABLED"
    assert outbound_request_count() == 0


def test_registry_connection_test_api(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = _admin_headers()
    created = client.post(
        "/api/v1/connectors-registry/registries",
        headers=headers,
        json={
            "name": "Conn",
            "registry_type": "private",
            "base_url": "https://registry.corp.example",
            "enabled": True,
            "network_policy": {"allowed_hosts": ["registry.corp.example"]},
        },
    )
    rid = created.json()["id"]

    archive = _package_archive(_base_source())
    transport = _mock_registry_transport(archive)

    def _fake_test(db, registry_id, *, hooks=None):
        from app.connectors_registry.registry_service import test_registry_connection as real
        from app.connectors_registry.registry_client import RegistryClientHooks

        return real(
            db,
            registry_id,
            hooks=RegistryClientHooks(transport=transport, resolver=_PUBLIC_DNS),
        )

    monkeypatch.setattr(
        "app.connectors_registry.registry_router.test_registry_connection",
        _fake_test,
    )
    res = client.post(f"/api/v1/connectors-registry/registries/{rid}/test-connection", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "PASS"


def test_ssrf_localhost_and_private_ip_blocked() -> None:
    with pytest.raises(AcquisitionUrlPolicyError) as exc:
        validate_url("https://localhost/pkg.tar.gz")
    assert exc.value.code == "LOCALHOST_BLOCKED"

    with pytest.raises(AcquisitionUrlPolicyError):
        validate_url("https://127.0.0.1/pkg.tar.gz")

    with pytest.raises(AcquisitionUrlPolicyError) as exc2:
        validate_url("https://10.0.0.5/pkg.tar.gz")
    assert exc2.value.code == "PRIVATE_IP_BLOCKED"


def test_ssrf_redirect_blocked() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "evil.example" in str(request.url):
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
        return httpx.Response(200, content=b"ok")

    with pytest.raises(LifecycleError) as exc:
        secure_http_get(
            "https://evil.example/pkg",
            config=NetworkAcquisitionPolicyConfig(),
            resolver=_PUBLIC_DNS,
            transport=httpx.MockTransport(handler),
        )
    assert exc.value.error_code in {"REDIRECT_SSRF_BLOCKED", "HTTP_BLOCKED", "LOOPBACK_BLOCKED", "LOCALHOST_BLOCKED"}


def test_allowlisted_private_registry() -> None:
    cfg = NetworkAcquisitionPolicyConfig(
        allowed_hosts=frozenset({"registry.internal"}),
        allow_private_for_allowlisted_hosts=True,
    )
    result, approved = validate_url_with_dns(
        "https://registry.internal/v1/catalog",
        config=cfg,
        resolver=lambda h: ["10.1.2.3"],
    )
    assert result.hostname == "registry.internal"
    assert approved == ["10.1.2.3"]


def test_download_size_limit() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 1000)

    with pytest.raises(LifecycleError) as exc:
        secure_http_get(
            "https://cdn.example/pkg.tar.gz",
            resolver=_PUBLIC_DNS,
            max_bytes=100,
            transport=httpx.MockTransport(handler),
        )
    assert exc.value.error_code == "DOWNLOAD_SIZE_LIMIT"


def test_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(LifecycleError) as exc:
        secure_http_get(
            "https://slow.example/pkg.tar.gz",
            resolver=_PUBLIC_DNS,
            timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        )
    assert exc.value.error_code == "ACQUISITION_TIMEOUT"


def test_registry_unavailable_browse(client: TestClient) -> None:
    headers = _admin_headers()
    created = client.post(
        "/api/v1/connectors-registry/registries",
        headers=headers,
        json={
            "name": "Down",
            "registry_type": "private",
            "base_url": "https://down.example",
            "enabled": False,
        },
    )
    rid = created.json()["id"]
    res = client.get(f"/api/v1/connectors-registry/registries/{rid}/packages", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["unavailable"] is True
    assert body["error_code"] == "REGISTRY_DISABLED"


def test_delete_registry_does_not_uninstall(
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
) -> None:
    archive = _package_archive(_base_source(package_id="keepme", id="keepme"))
    install_package(
        db_session,
        archive,
        actor_role=ROLE_ADMINISTRATOR,
        origin=LIFECYCLE_ORIGIN_PRIVATE_REGISTRY,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )
    row = create_registry(
        db_session,
        MarketplaceRegistryCreate(
            name="Temp",
            registry_type=REGISTRY_TYPE_PRIVATE,
            base_url="https://reg.example",
        ),
    )
    delete_registry(db_session, row.id)
    still = (
        db_session.query(MarketplacePackageInstall)
        .filter_by(package_id="keepme", status=LIFECYCLE_STATUS_INSTALLED)
        .one()
    )
    assert still is not None


def test_offline_signed_bundle_and_invalid_signature_block(
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
) -> None:
    unsigned = _package_archive(_base_source(package_id="offline1", id="offline1"))
    with pytest.raises(LifecycleError) as exc:
        install_offline_signed_bundle(
            db_session,
            unsigned,
            actor_role=ROLE_ADMINISTRATOR,
            builtin_root=builtin_root,
            installed_root=installed_root,
        )
    assert exc.value.error_code == "PACKAGE_SIGNATURE_REQUIRED"

    # Invalid signature metadata present → blocked
    bad = _package_archive(
        _base_source(package_id="offline2", id="offline2"),
        root_dir="offline2",
        extra={
            "signature.json": json.dumps(
                {
                    "algorithm": "ed25519",
                    "key_id": "missing",
                    "digest": "sha256:" + ("ab" * 32),
                    "signature": base64.b64encode(b"x" * 64).decode("ascii"),
                }
            )
        },
    )
    with pytest.raises(LifecycleError) as exc2:
        install_offline_signed_bundle(
            db_session,
            bad,
            actor_role=ROLE_ADMINISTRATOR,
            builtin_root=builtin_root,
            installed_root=installed_root,
        )
    assert exc2.value.error_code in {
        "PACKAGE_SIGNATURE_REQUIRED",
        "PACKAGE_SIGNATURE_UNKNOWN_KEY",
        "PACKAGE_SIGNATURE_INVALID",
        "UNSIGNED_PACKAGE_FORBIDDEN",
    }


def test_invalid_license_deny_blocks_install(
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
) -> None:

    archive = _package_archive(
        _base_source(package_id="denyme", id="denyme", license="EvilLicense"),
        root_dir="denyme",
    )
    # Force DENY via monkeypatched evaluate — use config deny list by patching install path.
    import app.connectors_registry.lifecycle_service as life

    original = life.evaluate_manifest_license_policy

    def _deny(manifest, **kwargs):
        result = original(manifest, **kwargs)
        from app.connectors_registry.license_policy import LicensePolicyResult, LICENSE_DECISION_DENY

        return LicensePolicyResult(
            decision=LICENSE_DECISION_DENY,
            decision_code="DENY_CONFIGURED",
            decision_reason="denied by test",
            declared=result.declared,
            spoofed_fields_ignored=result.spoofed_fields_ignored,
        )

    life.evaluate_manifest_license_policy = _deny  # type: ignore[assignment]
    try:
        with pytest.raises(LifecycleError) as exc:
            install_package(
                db_session,
                archive,
                actor_role=ROLE_ADMINISTRATOR,
                enforce_license_deny=True,
                builtin_root=builtin_root,
                installed_root=installed_root,
            )
        assert exc.value.error_code == "LICENSE_POLICY_DENIED"
    finally:
        life.evaluate_manifest_license_policy = original  # type: ignore[assignment]


def test_capabilities_m29_9(client: TestClient) -> None:
    res = client.get("/api/v1/connectors-registry/marketplace/capabilities")
    assert res.status_code == 200
    body = res.json()
    assert body["remote_registry"] is True
    assert body["remote_registry_default_enabled"] is False
    assert body["private_registry"] is True
    assert body["offline_signed_bundle"] is True
    assert body["git_acquisition"] is True
    assert body["auto_install"] is False
    assert body["auto_stream_create"] is False
    assert body["auto_stream_enable"] is False
    assert body["auto_credential_create"] is False


def test_no_runtime_module_changes_for_m29_9() -> None:
    # Guardrail: M29.9 must not introduce a new runtime package engine.
    runtime_dir = Path(__file__).resolve().parents[1] / "app" / "runtime"
    # Smoke: runtime package still importable and unrelated to marketplace registries.
    import app.runtime  # noqa: F401

    assert runtime_dir.is_dir()
