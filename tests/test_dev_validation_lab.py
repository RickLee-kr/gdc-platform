"""Tests for the development validation lab seeder (additive, idempotent)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dev_validation_lab import templates as T
from app.dev_validation_lab.seeder import lab_effective, seed_dev_validation_lab
from app.runtime.health_scoring_policy import stream_config_excluded_from_health_scoring
from app.logs.models import DeliveryLog
from app.main import app
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.models import ContinuousValidation


EXPECTED_SOURCE_EXPANSION_NAMES = {
    "HTTP_API_POLLING": "[DEV VALIDATION] Stream single-object",
    "DATABASE_QUERY": "[DEV VALIDATION] Database Query PostgreSQL E2E",
    "S3_OBJECT_POLLING": "[DEV VALIDATION] S3 Object Polling E2E",
    "REMOTE_FILE_POLLING": "[DEV VALIDATION] Remote File SFTP E2E",
}


def _enable_lab(monkeypatch: pytest.MonkeyPatch, *, wiremock_base: str | None = None) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    monkeypatch.setattr(settings, "DEV_VALIDATION_AUTO_START", False, raising=False)
    if wiremock_base:
        monkeypatch.setattr(settings, "DEV_VALIDATION_WIREMOCK_BASE_URL", wiremock_base, raising=False)


@pytest.fixture
def api_client(db_session: Session):
    def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_lab_effective_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", False, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "development", raising=False)
    assert lab_effective() is False


def test_lab_effective_forced_off_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "production", raising=False)
    assert lab_effective() is False


def test_seed_skipped_in_production(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_LAB", True, raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "production", raising=False)
    out = seed_dev_validation_lab(db_session)
    assert out.get("skipped") is True


def test_idempotent_seeding(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    _enable_lab(monkeypatch)
    a = seed_dev_validation_lab(db_session)
    b = seed_dev_validation_lab(db_session)
    assert a.get("skipped") is False
    assert b.get("skipped") is False
    inv = a.get("inventory") or {}
    assert int(inv.get("connectors_in_db", 0)) >= 9
    assert int(inv.get("validations_lab_template_or_name", 0)) >= 12
    n_streams = db_session.query(Stream).filter(Stream.name.startswith("[DEV VALIDATION]")).count()
    assert n_streams == 19
    n_val = (
        db_session.query(ContinuousValidation)
        .filter(ContinuousValidation.template_key.isnot(None))
        .filter(ContinuousValidation.template_key.startswith("dev_lab_"))
        .count()
    )
    assert n_val >= 10
    assert a.get("source_type_display_counts", {}).get("HTTP_API_POLLING", 0) >= 1
    assert b.get("source_type_display_counts", {}).get("DATABASE_QUERY", 0) >= 1


def test_source_expansion_contract_seeded_and_idempotent(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    _enable_lab(monkeypatch)
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_S3", False, raising=False)
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_DATABASE_QUERY", False, raising=False)
    monkeypatch.setattr(settings, "ENABLE_DEV_VALIDATION_REMOTE_FILE", False, raising=False)

    first = seed_dev_validation_lab(db_session)
    counts_before = {
        source_type: db_session.query(Stream).filter(Stream.stream_type == source_type).count()
        for source_type in EXPECTED_SOURCE_EXPANSION_NAMES
    }
    second = seed_dev_validation_lab(db_session)
    counts_after = {
        source_type: db_session.query(Stream).filter(Stream.stream_type == source_type).count()
        for source_type in EXPECTED_SOURCE_EXPANSION_NAMES
    }

    assert first.get("skipped") is False
    assert second.get("skipped") is False
    assert counts_before == counts_after
    for source_type, name in EXPECTED_SOURCE_EXPANSION_NAMES.items():
        row = db_session.query(Stream).filter(Stream.name == name).one()
        source = db_session.query(Source).filter(Source.id == row.source_id).one()
        assert row.stream_type == source_type
        assert source.source_type == source_type
        assert row.enabled is True
        assert row.status == "RUNNING"


def test_streams_api_returns_source_expansion_metadata(
    monkeypatch: pytest.MonkeyPatch, db_session: Session, api_client: TestClient
) -> None:
    _enable_lab(monkeypatch)
    seed_dev_validation_lab(db_session)

    res = api_client.get("/api/v1/streams/")
    assert res.status_code == 200, res.text
    rows = {
        row["name"]: row
        for row in res.json()
        if isinstance(row, dict) and str(row.get("name") or "").startswith(T.LAB_NAME_PREFIX)
    }

    for source_type, name in EXPECTED_SOURCE_EXPANSION_NAMES.items():
        row = rows[name]
        assert row["stream_type"] == source_type
        assert row["source_type"] == source_type


def test_lab_streams_health_scoring_flags_after_seed(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    _enable_lab(monkeypatch)
    seed_dev_validation_lab(db_session)
    rows = db_session.query(Stream).filter(Stream.name.startswith(T.LAB_NAME_PREFIX)).all()
    assert rows
    negative_names = {T.LAB_NAME_PREFIX + t for t in T.LAB_NEGATIVE_PATH_STREAM_TITLES}
    for row in rows:
        cfg = dict(row.config_json or {})
        assert cfg.get("exclude_from_health_scoring") is True
        assert stream_config_excluded_from_health_scoring(cfg) is True
        if row.name in negative_names:
            assert cfg.get("validation_expected_failure") is True
        else:
            assert "validation_expected_failure" not in cfg


def test_validation_definitions_visible_after_seed(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    _enable_lab(monkeypatch)
    seed_dev_validation_lab(db_session)
    rows = (
        db_session.query(ContinuousValidation)
        .filter(ContinuousValidation.template_key == "dev_lab_full_single")
        .all()
    )
    assert len(rows) == 1
    assert rows[0].enabled is True
    assert rows[0].target_stream_id is not None


@pytest.mark.wiremock_integration
def test_lab_stream_run_once_produces_delivery_logs_when_wiremock_reachable(
    monkeypatch: pytest.MonkeyPatch, db_session: Session, api_client: TestClient
) -> None:
    from app.dev_validation_lab.lab_throughput_wiremock import sync_lab_throughput_wiremock_mappings
    from tests.e2e_wiremock_helpers import DEFAULT_WIREMOCK, ensure_template_wiremock_mappings, wiremock_reachable

    base = os.getenv("WIREMOCK_BASE_URL", DEFAULT_WIREMOCK).rstrip("/")
    if not wiremock_reachable(base):
        pytest.skip(f"WireMock not reachable at {base}")

    ensure_template_wiremock_mappings(base)
    assert sync_lab_throughput_wiremock_mappings(base_url=base), (
        "lab throughput WireMock stubs must be registered for /api/v1/lab-throughput/* paths"
    )
    _enable_lab(monkeypatch, wiremock_base=base)

    seed_dev_validation_lab(db_session)
    db_session.expire_all()

    st = (
        db_session.query(Stream)
        .filter(Stream.name == "[DEV VALIDATION] Stream single-object")
        .one()
    )
    res = api_client.post(f"/api/v1/runtime/streams/{st.id}/run-once")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("transaction_committed") is True

    db_session.expire_all()
    logs = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == int(st.id)).all()
    stages = {str(x.stage) for x in logs}
    assert "run_started" in stages
    assert "run_complete" in stages
