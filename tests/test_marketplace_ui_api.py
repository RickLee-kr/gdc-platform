"""Tests for M29.8 Marketplace UI catalog/capabilities/validate/builder APIs."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.jwt_service import issue_access_token
from app.auth.role_guard import ROLE_ADMINISTRATOR
from app.connectors_registry.builder.service import PRODUCTION_AI_PROVIDER_IMPLEMENTED
from app.connectors_registry.lifecycle_service import install_package
from app.connectors_registry.marketplace_catalog import (
    TRUST_TIER_COMMUNITY,
    TRUST_TIER_IMPORTED,
    TRUST_TIER_LOCAL_DRAFT,
    TRUST_TIER_OFFICIAL,
    TRUST_TIER_PRIVATE,
    derive_trust_tier,
)
from app.connectors_registry.service import clear_registry_cache, reload_registry
from app.database import get_db
from app.main import app


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
    extra: dict[str, str] | None = None,
) -> bytes:
    files = {f"{root_dir}/manifest.yaml": yaml.safe_dump(manifest, sort_keys=False)}
    if extra:
        for rel, body in extra.items():
            files[f"{root_dir}/{rel}"] = body
    return _make_tar_gz(files)


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
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_registry_cache()


def _bearer(role: str = ROLE_ADMINISTRATOR) -> dict[str, str]:
    token, _ = issue_access_token(username="mkt-ui", user_id=7, role=role, token_version=1)
    return {"Authorization": f"Bearer {token}"}


def _install(
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
    manifest: dict[str, Any],
    *,
    root_dir: str = "acme",
) -> None:
    install_package(
        db_session,
        _package_archive(manifest, root_dir=root_dir),
        builtin_root=builtin_root,
        installed_root=installed_root,
        actor_role=ROLE_ADMINISTRATOR,
    )


# --- Trust tier derivation (unit) ---


def test_trust_tier_builtin_official() -> None:
    assert (
        derive_trust_tier(
            installed_from="builtin",
            capabilities={},
            upstream_provenance={},
            signature_status=None,
        )
        == TRUST_TIER_OFFICIAL
    )


def test_trust_tier_builder_draft_local() -> None:
    tier = derive_trust_tier(
        installed_from="installed",
        capabilities={"builder_draft": True},
        upstream_provenance={"import_method": "ai_builder", "builder_trust_candidate": "Local Draft"},
        signature_status="UNSIGNED",
    )
    assert tier == TRUST_TIER_LOCAL_DRAFT


def test_trust_tier_builder_imported_draft_maps_to_imported() -> None:
    tier = derive_trust_tier(
        installed_from="installed",
        capabilities={"builder_draft": True},
        upstream_provenance={"import_method": "ai_builder", "builder_trust_candidate": "Imported Draft"},
        signature_status="UNSIGNED",
    )
    assert tier == TRUST_TIER_IMPORTED


def test_trust_tier_harvester_marker_imported() -> None:
    tier = derive_trust_tier(
        installed_from="installed",
        capabilities={"harvester_draft": True},
        upstream_provenance={"import_method": "structured_metadata_fixture"},
        signature_status="UNSIGNED",
    )
    assert tier == TRUST_TIER_IMPORTED


def test_trust_tier_signed_unsigned_no_markers() -> None:
    assert (
        derive_trust_tier(
            installed_from="installed",
            capabilities={},
            upstream_provenance={},
            signature_status="VALID",
        )
        == TRUST_TIER_COMMUNITY
    )
    assert (
        derive_trust_tier(
            installed_from="installed",
            capabilities={},
            upstream_provenance={},
            signature_status="UNSIGNED",
        )
        == TRUST_TIER_PRIVATE
    )


def test_trust_tier_never_reads_manifest_self_claim() -> None:
    # Manifest self-claims for trust_tier/Verified/Official must never be consulted;
    # derive_trust_tier does not accept such a parameter at all, so this documents intent.
    assert "trust_tier" not in derive_trust_tier.__code__.co_varnames[: derive_trust_tier.__code__.co_argcount]


# --- Catalog / detail ---


def test_catalog_lists_builtin_package(
    client: TestClient, builtin_root: Path
) -> None:
    pkg_dir = builtin_root / "widget"
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "manifest.yaml").write_text(
        yaml.safe_dump(_base_source(id="widget", package_id="widget")),
        encoding="utf-8",
    )
    reload_registry(root=builtin_root, installed_root=None)

    r = client.get("/api/v1/connectors-registry/marketplace/catalog", headers=_bearer())
    assert r.status_code == 200, r.text
    body = r.json()
    ids = {p["package_id"] for p in body["packages"]}
    assert "widget" in ids
    card = next(p for p in body["packages"] if p["package_id"] == "widget")
    assert card["trust_tier"] == TRUST_TIER_OFFICIAL
    assert card["origin"] == "Builtin"


def test_catalog_installed_package_and_search_filter(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(db_session, builtin_root, installed_root, _base_source())

    r = client.get("/api/v1/connectors-registry/marketplace/catalog", headers=_bearer())
    assert r.status_code == 200
    body = r.json()
    card = next(p for p in body["packages"] if p["package_id"] == "acme")
    assert card["installed"] is True
    assert card["installed_version"] == "1.0.0"
    assert card["vendor"] == "Acme"
    assert card["license"]["declared"] == "MIT"
    assert card["license"]["decision"] == "ALLOW"
    assert card["verification"]["signature_status"] == "UNSIGNED"
    assert {s["id"] for s in card["available_streams"]} == {"events"}

    # search filter
    r2 = client.get(
        "/api/v1/connectors-registry/marketplace/catalog",
        params={"q": "acme"},
        headers=_bearer(),
    )
    assert r2.status_code == 200
    assert {p["package_id"] for p in r2.json()["packages"]} == {"acme"}

    r3 = client.get(
        "/api/v1/connectors-registry/marketplace/catalog",
        params={"q": "does-not-exist"},
        headers=_bearer(),
    )
    assert r3.json()["packages"] == []

    # installed filter
    r4 = client.get(
        "/api/v1/connectors-registry/marketplace/catalog",
        params={"installed": "true"},
        headers=_bearer(),
    )
    assert {p["package_id"] for p in r4.json()["packages"]} == {"acme"}


def test_catalog_compatibility_warning_surfaced(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(
        db_session,
        builtin_root,
        installed_root,
        _base_source(
            platform_compatibility={
                "supported_source_types": ["WEBHOOK_RECEIVER"],
            }
        ),
    )
    r = client.get("/api/v1/connectors-registry/marketplace/catalog", headers=_bearer())
    card = next(p for p in r.json()["packages"] if p["package_id"] == "acme")
    assert card["compatibility"]["warnings"]

    r2 = client.get(
        "/api/v1/connectors-registry/marketplace/catalog",
        params={"compatibility": "warning"},
        headers=_bearer(),
    )
    assert "acme" in {p["package_id"] for p in r2.json()["packages"]}


def test_package_detail_not_found(client: TestClient) -> None:
    r = client.get(
        "/api/v1/connectors-registry/marketplace/packages/does-not-exist",
        headers=_bearer(),
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "PACKAGE_NOT_FOUND"


def test_package_detail_matches_catalog_card(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(db_session, builtin_root, installed_root, _base_source())
    detail = client.get(
        "/api/v1/connectors-registry/marketplace/packages/acme",
        headers=_bearer(),
    )
    assert detail.status_code == 200
    assert detail.json()["package_id"] == "acme"
    assert detail.json()["installed"] is True


def test_stream_extension_discovery(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(db_session, builtin_root, installed_root, _base_source())
    _install(
        db_session,
        builtin_root,
        installed_root,
        _base_source(
            id="acme_ext",
            package_id="acme_ext",
            package_kind="stream_extension",
            requires={"package_id": "acme", "version": ">=1.0.0"},
            streams=[{"id": "extra", "name": "Extra"}],
        ),
        root_dir="acme_ext",
    )

    r = client.get(
        "/api/v1/connectors-registry/marketplace/packages/acme",
        headers=_bearer(),
    )
    assert r.status_code == 200
    extensions = r.json()["stream_extensions"]
    assert any(e["package_id"] == "acme_ext" for e in extensions)
    ext_card = next(
        p
        for p in client.get(
            "/api/v1/connectors-registry/marketplace/catalog", headers=_bearer()
        ).json()["packages"]
        if p["package_id"] == "acme_ext"
    )
    assert ext_card["requires"][0]["package_id"] == "acme"


# --- Capabilities ---


def test_capabilities_endpoint(client: TestClient) -> None:
    r = client.get("/api/v1/connectors-registry/marketplace/capabilities", headers=_bearer())
    assert r.status_code == 200
    body = r.json()
    assert body["git_acquisition"] is True
    assert "SSRF" in body["git_acquisition_reason"] or "tar.gz" in body["git_acquisition_reason"]
    assert body["remote_registry"] is True
    assert body["remote_registry_default_enabled"] is False
    assert body["private_registry"] is True
    assert body["offline_signed_bundle"] is True
    assert body["auto_install"] is False
    assert body["auto_stream_create"] is False
    assert body["auto_stream_enable"] is False
    assert body["auto_credential_create"] is False
    assert body["production_ai_provider_implemented"] == PRODUCTION_AI_PROVIDER_IMPLEMENTED
    assert set(body["deterministic_builder_providers"]) == {"fixture", "manual"}
    assert body["auto_install"] is False
    assert body["auto_stream_create"] is False
    assert body["auto_stream_enable"] is False
    assert body["auto_credential_create"] is False
    assert body["trust_auto_promotion"] is False
    assert body["supported_upload_formats"] == [".tar.gz", ".tgz"]


# --- Validate ---


def test_validate_pass_does_not_install(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    archive = _package_archive(_base_source())
    r = client.post(
        "/api/v1/connectors-registry/packages/validate",
        headers=_bearer(),
        files={"file": ("acme.tar.gz", archive, "application/gzip")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "PASS"
    assert body["package_id"] == "acme"
    assert body["signature_status"] == "UNSIGNED"
    assert body["license_decision"] == "ALLOW"

    # Not installed as a result of validation.
    listing = client.get("/api/v1/connectors-registry/packages", headers=_bearer())
    assert listing.json()["count"] == 0


def test_validate_fail_bad_manifest(client: TestClient) -> None:
    # Syntactically valid YAML, but missing required manifest fields (no auth/source_type).
    archive = _make_tar_gz(
        {"acme/manifest.yaml": yaml.safe_dump({"id": "acme", "name": "Acme", "vendor": "Acme"})}
    )
    r = client.post(
        "/api/v1/connectors-registry/packages/validate",
        headers=_bearer(),
        files={"file": ("acme.tar.gz", archive, "application/gzip")},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "FAIL"
    assert r.json()["blocked_reasons"]


def test_validate_rejects_non_tar_gz_upload(client: TestClient) -> None:
    r = client.post(
        "/api/v1/connectors-registry/packages/validate",
        headers=_bearer(),
        files={"file": ("acme.zip", b"not a real archive", "application/zip")},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "UNSUPPORTED_PACKAGE_FORMAT"


def test_validate_dependency_missing_blocked(client: TestClient) -> None:
    archive = _package_archive(
        _base_source(
            id="acme_ext",
            package_id="acme_ext",
            package_kind="stream_extension",
            requires={"package_id": "does-not-exist", "version": ">=1.0.0"},
        ),
        root_dir="acme_ext",
    )
    r = client.post(
        "/api/v1/connectors-registry/packages/validate",
        headers=_bearer(),
        files={"file": ("acme_ext.tar.gz", archive, "application/gzip")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "FAIL"
    assert any("DEPENDENCY_MISSING" in reason for reason in body["blocked_reasons"])


# --- Builder draft ---


def test_builder_draft_fixture_local_draft(client: TestClient) -> None:
    r = client.post(
        "/api/v1/connectors-registry/marketplace/builder/draft",
        headers=_bearer(),
        json={
            "provider_name": "fixture",
            "vendor": "Acme",
            "product": "Events API",
            "openapi": {
                "openapi": "3.0.0",
                "info": {"title": "Events", "version": "1.0"},
                "paths": {
                    "/events": {
                        "get": {
                            "operationId": "listEvents",
                            "responses": {"200": {"description": "ok"}},
                        }
                    }
                },
            },
            "sample": {"items": [{"id": 1}]},
            "trust_candidate": "Local Draft",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["trust_candidate"] == "Local Draft"
    assert body["status"] in {"READY_DRAFT", "NEEDS_REVIEW", "INCOMPLETE"}
    # Never auto-installs — package_path (if any) stays a draft on disk only.
    if body["package_generated"]:
        assert body["package_path"]


def test_builder_draft_manual_requires_supplied_translation(client: TestClient) -> None:
    r = client.post(
        "/api/v1/connectors-registry/marketplace/builder/draft",
        headers=_bearer(),
        json={"provider_name": "manual"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "BLOCKED"
    assert any(i["code"] == "MANUAL_TRANSLATION_REQUIRED" for i in body["validation_issues"])


def test_builder_draft_production_ai_provider_unavailable(client: TestClient) -> None:
    r = client.post(
        "/api/v1/connectors-registry/marketplace/builder/draft",
        headers=_bearer(),
        json={"provider_name": "openai-production"},
    )
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["error_code"] == "AI_PROVIDER_UNAVAILABLE"
    assert detail["production_ai_provider_implemented"] is False
