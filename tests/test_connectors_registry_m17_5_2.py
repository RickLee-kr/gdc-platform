"""Tests for M17.5.2 Manifest Loader — resource loading, validation, and APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors_registry.loader import load_connector_modules
from app.connectors_registry.service import bootstrap_registry, clear_registry_cache
from app.connectors_registry.validator import (
    validate_api_test_yaml,
    validate_enrichment_json,
    validate_mapping_json,
    validate_stream_template,
)
from app.database import get_db
from app.main import app


def _write_manifest(module_dir: Path, payload: dict[str, Any]) -> Path:
    module_dir.mkdir(parents=True, exist_ok=True)
    path = module_dir / "manifest.yaml"
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return path


def _write_stream(module_dir: Path, stream_id: str, payload: dict[str, Any]) -> Path:
    streams_dir = module_dir / "streams"
    streams_dir.mkdir(parents=True, exist_ok=True)
    path = streams_dir / f"{stream_id}.yaml"
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return path


def _write_mapping(module_dir: Path, name: str, payload: Any) -> Path:
    mappings_dir = module_dir / "mappings"
    mappings_dir.mkdir(parents=True, exist_ok=True)
    path = mappings_dir / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _write_enrichment(module_dir: Path, name: str, payload: Any) -> Path:
    enrichments_dir = module_dir / "enrichments"
    enrichments_dir.mkdir(parents=True, exist_ok=True)
    path = enrichments_dir / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _valid_manifest(connector_id: str = "acme") -> dict[str, Any]:
    return {
        "id": connector_id,
        "name": "Acme API",
        "vendor": "Acme",
        "version": "1.0.0",
        "source_type": "HTTP_API_POLLING",
        "auth": {"type": "bearer"},
        "streams": [
            {
                "id": "events",
                "name": "Events",
                "template": "streams/events.yaml",
                "default_mapping": "mappings/events.default.json",
                "default_enrichment": "enrichments/events.default.json",
            }
        ],
        "capabilities": {"api_test": True},
    }


def _valid_stream() -> dict[str, Any]:
    return {
        "stream_id": "events",
        "name": "Events poll stream",
        "config_json": {"endpoint": "/events", "method": "GET"},
    }


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


def test_resolved_manifest_load(registry_root: Path) -> None:
    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())
    _write_mapping(module_dir, "events.default.json", {"stream_id": "events", "field_mappings_json": {}})
    _write_enrichment(module_dir, "events.default.json", {"stream_id": "events", "enrichment_json": {}})
    (module_dir / "api_test.yaml").write_text("stream_overrides: {}\n", encoding="utf-8")
    (module_dir / "docs.md").write_text("# Acme Connector\n\nSetup guide.\n", encoding="utf-8")

    result = load_connector_modules(root=registry_root)
    entry = result.modules["acme"]
    assert entry.status == "valid"
    assert entry.resources.summary.streams_count == 1
    assert entry.resources.summary.mappings_count == 1
    assert entry.resources.summary.enrichments_count == 1
    assert entry.resources.summary.has_api_test is True
    assert entry.resources.summary.has_docs is True
    assert entry.resources.docs is not None
    assert entry.resources.docs.title == "Acme Connector"
    assert "Setup guide" in (entry.resources.docs.summary or "")


def test_stream_template_load(registry_root: Path) -> None:
    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())

    result = load_connector_modules(root=registry_root)
    stream = result.modules["acme"].resources.streams["events"]
    assert stream["config_json"]["endpoint"] == "/events"


def test_mapping_and_enrichment_load(registry_root: Path) -> None:
    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())
    _write_mapping(
        module_dir,
        "events.default.json",
        {"stream_id": "events", "field_mappings_json": {"event_id": "$.id"}},
    )
    _write_enrichment(
        module_dir,
        "events.default.json",
        {"stream_id": "events", "enrichment_json": {"vendor": "Acme"}},
    )

    result = load_connector_modules(root=registry_root)
    entry = result.modules["acme"]
    assert entry.resources.mappings["events.default"]["field_mappings_json"]["event_id"] == "$.id"
    assert entry.resources.enrichments["events.default"]["enrichment_json"]["vendor"] == "Acme"


def test_api_test_load(registry_root: Path) -> None:
    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())
    (module_dir / "api_test.yaml").write_text(
        yaml.safe_dump({"stream_overrides": {"events": {"pagination": {"type": "offset_limit"}}}}),
        encoding="utf-8",
    )

    result = load_connector_modules(root=registry_root)
    assert result.modules["acme"].resources.api_test is not None
    assert "events" in result.modules["acme"].resources.api_test["stream_overrides"]


def test_docs_metadata_load_no_raw_body(registry_root: Path) -> None:
    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())
    long_body = "# Title\n\n" + ("x" * 5000)
    (module_dir / "docs.md").write_text(long_body, encoding="utf-8")

    result = load_connector_modules(root=registry_root)
    docs = result.modules["acme"].resources.docs
    assert docs is not None
    assert docs.title == "Title"
    assert docs.summary == "x" * 200
    assert len(docs.summary or "") <= 200


def test_invalid_stream_validation_still_in_catalog(registry_root: Path) -> None:
    module_dir = registry_root / "bad-stream"
    _write_manifest(module_dir, _valid_manifest("bad-stream"))
    _write_stream(
        module_dir,
        "events",
        {"stream_id": "events", "name": "Events"},
    )

    result = load_connector_modules(root=registry_root)
    entry = result.modules["bad-stream"]
    assert entry.status == "invalid"
    assert any(issue.rule_id == "STR-003" for issue in entry.errors)


def test_invalid_mapping_validation(registry_root: Path) -> None:
    module_dir = registry_root / "bad-map"
    _write_manifest(module_dir, _valid_manifest("bad-map"))
    _write_stream(module_dir, "events", _valid_stream())
    _write_mapping(module_dir, "events.default.json", "not-an-object")

    result = load_connector_modules(root=registry_root)
    entry = result.modules["bad-map"]
    assert entry.status == "invalid"
    assert any(issue.rule_id == "MAP-001" for issue in entry.errors)


def test_invalid_enrichment_validation_unit() -> None:
    issues = validate_enrichment_json("x", [], connector_id="c", path="/tmp/x.json")
    assert issues[0].rule_id == "ENR-001"


def test_invalid_api_test_validation_unit() -> None:
    issues = validate_api_test_yaml([], connector_id="c", path="/tmp/api_test.yaml")
    assert issues[0].rule_id == "API-001"


def test_stream_validation_rules_unit() -> None:
    issues = validate_stream_template(
        "events",
        {"stream_id": "events"},
        connector_id="c",
        path="/tmp/events.yaml",
    )
    rule_ids = {issue.rule_id for issue in issues}
    assert "STR-002" in rule_ids
    assert "STR-003" in rule_ids


def test_mapping_validation_rules_unit() -> None:
    issues = validate_mapping_json("m", "bad", connector_id="c", path="/tmp/m.json")
    assert issues[0].rule_id == "MAP-001"


def test_registry_api_resource_summary(
    client: TestClient,
    registry_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.connectors_registry.service.connectors_root", lambda: registry_root)
    monkeypatch.setattr("app.connectors_registry.loader.connectors_root", lambda: registry_root)

    module_dir = registry_root / "crowdstrike"
    _write_manifest(module_dir, _valid_manifest("crowdstrike"))
    _write_stream(module_dir, "events", _valid_stream())
    _write_mapping(module_dir, "events.default.json", {"stream_id": "events"})
    _write_enrichment(module_dir, "events.default.json", {"stream_id": "events"})
    (module_dir / "api_test.yaml").write_text("stream_overrides: {}\n", encoding="utf-8")
    (module_dir / "docs.md").write_text("# CS\n", encoding="utf-8")

    listed = client.get("/api/v1/connectors-registry/")
    assert listed.status_code == 200
    row = listed.json()["connectors"][0]
    assert row["status"] == "valid"
    assert row["resources"]["streams_count"] == 1
    assert row["resources"]["mappings_count"] == 1
    assert row["resources"]["enrichments_count"] == 1
    assert row["resources"]["has_api_test"] is True
    assert row["resources"]["has_docs"] is True


def test_resources_api(client: TestClient, registry_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.connectors_registry.service.connectors_root", lambda: registry_root)
    monkeypatch.setattr("app.connectors_registry.loader.connectors_root", lambda: registry_root)

    module_dir = registry_root / "acme"
    _write_manifest(module_dir, _valid_manifest())
    _write_stream(module_dir, "events", _valid_stream())
    _write_mapping(module_dir, "events.default.json", {"stream_id": "events", "field_mappings_json": {}})
    _write_enrichment(module_dir, "events.default.json", {"stream_id": "events", "enrichment_json": {}})
    (module_dir / "docs.md").write_text("# Acme\n", encoding="utf-8")

    bootstrap_registry(root=registry_root)

    detail = client.get("/api/v1/connectors-registry/acme")
    assert detail.status_code == 200
    resolved = detail.json()["resolved"]
    assert resolved["status"] == "valid"
    assert resolved["resources"]["streams_count"] == 1

    resources = client.get("/api/v1/connectors-registry/acme/resources")
    assert resources.status_code == 200
    body = resources.json()
    assert "events" in body["streams"]
    assert body["docs"]["title"] == "Acme"
    assert "Acme Connector" not in json.dumps(body)


def test_repository_crowdstrike_module_valid() -> None:
    result = load_connector_modules()
    entry = result.modules["crowdstrike"]
    assert entry.status == "valid"
    assert entry.resources.summary.streams_count == 2
    assert entry.resources.summary.mappings_count == 2
    assert entry.resources.summary.enrichments_count == 2
    assert entry.resources.summary.has_api_test is True
    assert entry.resources.summary.has_docs is True
    assert "detections" in entry.resources.streams
    assert "detections.default" in entry.resources.mappings


def test_invalid_modules_remain_in_catalog() -> None:
    result = load_connector_modules()
    for connector_id in ("wiz", "orca", "sentinelone"):
        assert connector_id in result.modules
        assert result.modules[connector_id].status == "invalid"
