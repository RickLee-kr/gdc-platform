"""P0 Marketplace Update Impact Preview + Test Before Apply tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors_registry.lifecycle_models import MarketplacePackageInstall
from app.connectors_registry.lifecycle_provenance import attach_provenance
from app.connectors_registry.lifecycle_service import install_package
from app.database import get_db, get_db_read_bounded
from app.main import app
from app.platform_admin.models import PlatformAuditEvent, PlatformConfigVersion
from app.streams.models import Stream
from tests.test_marketplace_package_lifecycle import _base_source, _package_archive
from tests.test_stream_runner_e2e import _seed_stream_runtime


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
    db_session: Session,
    builtin_root: Path,
    installed_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    monkeypatch.setattr("app.config.settings.GDC_PLUGINS_DIR", str(installed_root))
    monkeypatch.setattr(
        "app.connectors_registry.roots.builtin_connectors_root",
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
    monkeypatch.setattr(
        "app.connectors_registry.upgrade_impact_service.installed_plugins_root",
        lambda: installed_root,
    )

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _install(db: Session, installed_root: Path, builtin_root: Path, **overrides: Any) -> MarketplacePackageInstall:
    archive = _package_archive(_base_source(**overrides))
    read = install_package(
        db,
        archive,
        builtin_root=builtin_root,
        installed_root=installed_root,
    )
    row = db.query(MarketplacePackageInstall).filter(MarketplacePackageInstall.package_id == read.package_id).one()
    return row


def test_upgrade_impact_preview_success(client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path) -> None:
    _install(db_session, installed_root, builtin_root)
    candidate = _package_archive(
        _base_source(
            version="1.1.0",
            pack_version="1.1.0",
            name="Acme API v2",
            auth={"type": "api_key"},
            streams=[{"id": "events", "name": "Events"}, {"id": "alerts", "name": "Alerts"}],
            api_version="2024-01",
        )
    )

    # Capture counts before preview to assert no side effects
    versions_before = db_session.query(PlatformConfigVersion).count()
    audits_before = db_session.query(PlatformAuditEvent).count()
    checkpoints_before = db_session.query(Checkpoint).count()
    install_before = db_session.query(MarketplacePackageInstall).one()
    digest_before = install_before.digest
    pack_before = install_before.pack_version

    response = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade-impact-preview",
        files={"file": ("acme.tar.gz", candidate, "application/gzip")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["preview_only"] is True
    assert body["has_changes"] is True
    assert body["can_upgrade"] is True
    assert body["current_pack_version"] == "1.0.0"
    assert body["proposed_pack_version"] == "1.1.0"
    assert body["stream_config_unchanged"] is True
    assert body["checkpoint_unchanged"] is True
    assert body["schema_baseline_unchanged"] is True
    assert body["test"]["status"] in {"PASS", "WARNING"}
    assert any(w["code"] == "AUTH_CHANGE" for w in body["warnings"])
    assert "alerts" in body["affected"]["stream_ids_added"]

    # No mutations
    db_session.expire_all()
    install_after = db_session.query(MarketplacePackageInstall).one()
    assert install_after.digest == digest_before
    assert install_after.pack_version == pack_before
    assert db_session.query(PlatformConfigVersion).count() == versions_before
    assert db_session.query(PlatformAuditEvent).count() == audits_before
    assert db_session.query(Checkpoint).count() == checkpoints_before


def test_upgrade_impact_same_version_blocking(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(db_session, installed_root, builtin_root)
    same = _package_archive(_base_source())
    response = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade-impact-preview",
        files={"file": ("acme.tar.gz", same, "application/gzip")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["can_upgrade"] is False
    assert any(i["code"] == "SAME_VERSION" for i in body["blocking_issues"])
    assert body["test"]["status"] == "FAIL"


def test_upgrade_impact_affected_streams_and_apply_path(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    _install(db_session, installed_root, builtin_root)
    seeded = _seed_stream_runtime(db_session)
    stream = db_session.query(Stream).filter(Stream.id == int(seeded["stream_id"])).one()
    stream.config_json = attach_provenance(dict(stream.config_json or {}), package_id="acme", pack_version="1.0.0")
    stream.status = "RUNNING"
    db_session.commit()

    candidate = _package_archive(_base_source(version="2.0.0", pack_version="2.0.0", name="Acme v2"))
    preview = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade-impact-preview",
        files={"file": ("acme.tar.gz", candidate, "application/gzip")},
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_upgrade"] is True
    assert any(s["id"] == int(stream.id) for s in body["affected"]["streams"])
    assert any(w["code"] == "RUNNING_DEPENDENT_STREAMS" for w in body["warnings"])

    # Apply via existing upgrade path with stale protection fields
    apply = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade",
        files={"file": ("acme.tar.gz", candidate, "application/gzip")},
        data={
            "expected_base_digest": body["current_digest"],
            "expected_base_updated_at": body["current_updated_at"],
        },
    )
    assert apply.status_code == 200
    assert apply.json()["pack_version"] == "2.0.0"

    # Stream config / provenance pack_version not silently rewritten
    db_session.refresh(stream)
    provenance = (stream.config_json or {}).get("marketplace_provenance") or {}
    assert provenance.get("pack_version") == "1.0.0"


def test_upgrade_stale_preview_rejected(
    client: TestClient, db_session: Session, builtin_root: Path, installed_root: Path
) -> None:
    row = _install(db_session, installed_root, builtin_root)
    candidate = _package_archive(_base_source(version="1.2.0", pack_version="1.2.0"))
    preview = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade-impact-preview",
        files={"file": ("acme.tar.gz", candidate, "application/gzip")},
        data={"base_digest": "not-the-real-digest"},
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["stale_base"] is True
    assert body["can_upgrade"] is False
    assert any(i["code"] == "STALE_PACKAGE_BASE" for i in body["blocking_issues"])

    # Apply with wrong expected digest
    apply = client.post(
        "/api/v1/connectors-registry/packages/acme/upgrade",
        files={"file": ("acme.tar.gz", candidate, "application/gzip")},
        data={"expected_base_digest": "stale-digest"},
    )
    assert apply.status_code == 409
    assert apply.json()["detail"]["error_code"] == "STALE_PACKAGE_BASE"
    db_session.refresh(row)
    assert row.pack_version == "1.0.0"


def test_test_before_apply_no_change_and_success(
    client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    stream = db_session.query(Stream).filter(Stream.id == stream_id).one()
    stream.status = "STOPPED"
    db_session.commit()

    no_change = client.post(
        "/api/v1/runtime/test-before-apply/preview",
        json={
            "entity_type": "STREAM_CONFIG",
            "entity_id": stream_id,
            "proposed": {
                "name": stream.name,
                "enabled": stream.enabled,
                "polling_interval": stream.polling_interval,
                "config_json": stream.config_json,
                "rate_limit_json": stream.rate_limit_json,
            },
        },
    )
    assert no_change.status_code == 200
    assert no_change.json()["has_changes"] is False
    assert no_change.json()["can_apply"] is True
    assert no_change.json()["test"]["status"] in {"PASS", "WARNING"}

    versions_before = db_session.query(PlatformConfigVersion).count()
    preview = client.post(
        "/api/v1/runtime/test-before-apply/preview",
        json={
            "entity_type": "STREAM_CONFIG",
            "entity_id": stream_id,
            "proposed": {"polling_interval": int(stream.polling_interval or 60) + 15},
            "base_updated_at": stream.updated_at.isoformat() if stream.updated_at else None,
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["preview_only"] is True
    assert body["has_changes"] is True
    assert body["can_apply"] is True
    assert body["test"]["status"] in {"PASS", "WARNING"}
    assert db_session.query(PlatformConfigVersion).count() == versions_before

    apply = client.post(
        "/api/v1/runtime/test-before-apply/apply",
        json={
            "entity_type": "STREAM_CONFIG",
            "entity_id": stream_id,
            "proposed": {"polling_interval": int(stream.polling_interval or 60) + 15},
            "base_updated_at": body["current_updated_at"],
        },
    )
    assert apply.status_code == 200
    assert apply.json()["applied"] is True
    assert apply.json()["config_version"] is not None
    assert db_session.query(PlatformConfigVersion).count() == versions_before + 1


def test_test_before_apply_blocking_and_warning_evidence(
    client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    # RUNNING triggers warning via safe change
    preview = client.post(
        "/api/v1/runtime/test-before-apply/preview",
        json={
            "entity_type": "STREAM_CONFIG",
            "entity_id": stream_id,
            "proposed": {"polling_interval": 999},
            "test_evidence": {"connection_ok": False, "validated": True},
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_apply"] is False
    assert body["test"]["status"] == "FAIL"
    assert any(i["code"] == "CONNECTION_TEST_FAILED" for i in body["blocking_issues"])

    apply = client.post(
        "/api/v1/runtime/test-before-apply/apply",
        json={
            "entity_type": "STREAM_CONFIG",
            "entity_id": stream_id,
            "proposed": {"polling_interval": 999},
            "test_evidence": {"connection_ok": False},
        },
    )
    assert apply.status_code == 200
    assert apply.json()["applied"] is False
    assert apply.json()["no_op"] is True
