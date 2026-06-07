"""Tests for M17.5.1 Connector Registry — manifest discovery, validation, and APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors_registry.loader import load_connector_modules
from app.connectors_registry.service import bootstrap_registry, clear_registry_cache, reload_registry
from app.connectors_registry.validator import detect_duplicate_ids, validate_manifest_dict
from app.database import get_db
from app.main import app


def _write_manifest(module_dir: Path, payload: dict[str, Any], *, as_json: bool = False) -> Path:
    module_dir.mkdir(parents=True, exist_ok=True)
    path = module_dir / ("manifest.json" if as_json else "manifest.yaml")
    if as_json:
        path.write_text(json.dumps(payload), encoding="utf-8")
    else:
        path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return path


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    clear_registry_cache()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_registry_cache()


@pytest.fixture
def registry_root(tmp_path: Path) -> Path:
    return tmp_path / "connectors"


def test_manifest_load_from_filesystem(registry_root: Path) -> None:
    _write_manifest(
        registry_root / "acme",
        {
            "id": "acme",
            "name": "Acme API",
            "vendor": "Acme",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "bearer"},
            "streams": [{"id": "events", "name": "Events"}],
            "capabilities": {"api_test": True},
        },
    )

    result = load_connector_modules(root=registry_root)
    assert "acme" in result.modules
    assert result.modules["acme"].manifest.vendor == "Acme"
    assert result.issues == []


@pytest.mark.parametrize(
    ("payload", "rule_id"),
    [
        (
            {
                "name": "No Id",
                "vendor": "Acme",
                "version": "1.0.0",
                "source_type": "HTTP_API_POLLING",
                "auth": {"type": "bearer"},
                "streams": [{"id": "events", "name": "Events"}],
            },
            "MAN-001",
        ),
        (
            {
                "id": "no-vendor",
                "name": "No Vendor",
                "version": "1.0.0",
                "source_type": "HTTP_API_POLLING",
                "auth": {"type": "bearer"},
                "streams": [{"id": "events", "name": "Events"}],
            },
            "MAN-002",
        ),
        (
            {
                "id": "no-streams",
                "name": "No Streams",
                "vendor": "Acme",
                "version": "1.0.0",
                "source_type": "HTTP_API_POLLING",
                "auth": {"type": "bearer"},
                "streams": [],
            },
            "MAN-003",
        ),
        (
            {
                "id": "no-auth",
                "name": "No Auth",
                "vendor": "Acme",
                "version": "1.0.0",
                "source_type": "HTTP_API_POLLING",
                "streams": [{"id": "events", "name": "Events"}],
            },
            "MAN-004",
        ),
    ],
)
def test_manifest_validation_rules(payload: dict[str, Any], rule_id: str) -> None:
    _, issues = validate_manifest_dict(payload, manifest_path="/tmp/manifest.yaml")
    assert any(issue.rule_id == rule_id for issue in issues)


def test_duplicate_detection_first_path_wins(registry_root: Path) -> None:
    first = str(registry_root / "a" / "manifest.yaml")
    second = str(registry_root / "b" / "manifest.yaml")
    reject_paths, issues = detect_duplicate_ids([("dup", first), ("dup", second)])
    assert second in reject_paths
    assert first not in reject_paths
    assert any(issue.rule_id == "MAN-005" for issue in issues)

    _write_manifest(
        registry_root / "a",
        {
            "id": "dup",
            "name": "First",
            "vendor": "Acme",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "bearer"},
            "streams": [{"id": "events", "name": "Events"}],
        },
    )
    _write_manifest(
        registry_root / "b",
        {
            "id": "dup",
            "name": "Second",
            "vendor": "Acme",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "bearer"},
            "streams": [{"id": "events", "name": "Events"}],
        },
    )
    result = load_connector_modules(root=registry_root)
    assert list(result.modules.keys()) == ["dup"]
    assert result.modules["dup"].manifest.name == "First"
    assert any(issue.rule_id == "MAN-005" for issue in result.issues)


def test_reload_refreshes_cache(registry_root: Path) -> None:
    clear_registry_cache()
    _write_manifest(
        registry_root / "alpha",
        {
            "id": "alpha",
            "name": "Alpha",
            "vendor": "Acme",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "bearer"},
            "streams": [{"id": "events", "name": "Events"}],
        },
    )
    first = bootstrap_registry(root=registry_root)
    assert first.loaded_count == 1

    _write_manifest(
        registry_root / "beta",
        {
            "id": "beta",
            "name": "Beta",
            "vendor": "Acme",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "api_key"},
            "streams": [{"id": "logs", "name": "Logs"}],
        },
    )
    second = reload_registry(root=registry_root)
    assert second.loaded_count == 2
    assert set(second.connector_ids) == {"alpha", "beta"}


def test_api_list_detail_and_reload(client: TestClient, registry_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.connectors_registry.service.connectors_root", lambda: registry_root)
    monkeypatch.setattr("app.connectors_registry.loader.connectors_root", lambda: registry_root)

    _write_manifest(
        registry_root / "crowdstrike",
        {
            "id": "crowdstrike",
            "name": "CrowdStrike Falcon",
            "vendor": "CrowdStrike",
            "version": "1.0.0",
            "source_type": "HTTP_API_POLLING",
            "auth": {"type": "bearer"},
            "streams": [{"id": "detections", "name": "Detections"}],
            "capabilities": {"api_test": True},
        },
    )
    clear_registry_cache()
    bootstrap_registry(root=registry_root)

    listed = client.get("/api/v1/connectors-registry/")
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] == 1
    assert body["connectors"][0]["id"] == "crowdstrike"

    detail = client.get("/api/v1/connectors-registry/crowdstrike")
    assert detail.status_code == 200
    detail_body = detail.json()
    assert detail_body["resolved"]["vendor"] == "CrowdStrike"
    assert detail_body["resolved"]["streams"][0]["id"] == "detections"

    missing = client.get("/api/v1/connectors-registry/unknown-module")
    assert missing.status_code == 404

    reloaded = client.post("/api/v1/connectors-registry/reload")
    assert reloaded.status_code == 200
    assert reloaded.json()["loaded_count"] == 1


def test_repository_sample_manifests_load() -> None:
    result = load_connector_modules()
    ids = set(result.modules.keys())
    assert {"crowdstrike", "okta", "microsoft_graph"}.issubset(ids)
    assert result.modules["crowdstrike"].status == "valid"
