"""Backend tests for retention cleanup service and `/admin/retention-policy/run`."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.platform_admin.cleanup_service import (
    CATEGORIES,
    collect_due_categories,
    run_cleanup,
)
from app.platform_admin.repository import get_retention_policy_row
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.models import ContinuousValidation, ValidationRun

UTC = timezone.utc


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _seed_pipeline(db: Session) -> dict[str, int]:
    connector = Connector(name="ret-c", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"k": "v"},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="ret-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    dest = Destination(
        name="ret-d",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://x.example/h"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(dest)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"c": 1}))
    db.commit()
    return {"stream_id": stream.id, "route_id": route.id, "dest_id": dest.id, "connector_id": connector.id}


def _add_log(db: Session, *, ids: dict[str, int], created_at: datetime) -> int:
    row = DeliveryLog(
        connector_id=ids["connector_id"],
        stream_id=ids["stream_id"],
        route_id=ids["route_id"],
        destination_id=ids["dest_id"],
        stage="run_complete",
        level="INFO",
        status="OK",
        message="m",
        payload_sample={"x": 1},
        retry_count=0,
        http_status=None,
        latency_ms=None,
        error_code=None,
        created_at=created_at,
    )
    db.add(row)
    db.flush()
    return int(row.id)


def test_cleanup_logs_deletes_in_batches(db_session: Session) -> None:
    ids = _seed_pipeline(db_session)
    now = datetime.now(UTC)
    for delta in (45, 60, 75, 90, 100):
        _add_log(db_session, ids=ids, created_at=now - timedelta(days=delta))
    # fresh log that must remain
    _add_log(db_session, ids=ids, created_at=now - timedelta(days=2))
    db_session.commit()

    row = get_retention_policy_row(db_session)
    row.cleanup_batch_size = 2  # forces batching
    db_session.commit()

    outcomes = run_cleanup(db_session, categories=["logs"], dry_run=False)
    by_cat = {o.category: o for o in outcomes}
    assert by_cat["logs"].status == "ok"
    assert by_cat["logs"].deleted_count == 5
    assert db_session.query(DeliveryLog).count() == 1


def test_cleanup_dry_run_does_not_delete_or_mutate_policy(db_session: Session) -> None:
    ids = _seed_pipeline(db_session)
    now = datetime.now(UTC)
    _add_log(db_session, ids=ids, created_at=now - timedelta(days=60))
    db_session.commit()

    before_row = get_retention_policy_row(db_session)
    before_last = before_row.logs_last_cleanup_at

    outcomes = run_cleanup(db_session, categories=["logs"], dry_run=True)
    assert outcomes[0].dry_run is True
    assert outcomes[0].matched_count == 1
    assert outcomes[0].deleted_count == 0
    assert db_session.query(DeliveryLog).count() == 1

    db_session.expire_all()
    after = get_retention_policy_row(db_session)
    assert after.logs_last_cleanup_at == before_last


def test_cleanup_runtime_metrics_purges_validation_runs(db_session: Session) -> None:
    ids = _seed_pipeline(db_session)
    cv = ContinuousValidation(
        name="cv-1",
        enabled=True,
        validation_type="HEARTBEAT",
        target_stream_id=ids["stream_id"],
        schedule_seconds=60,
        expect_checkpoint_advance=False,
        last_status="HEALTHY",
    )
    db_session.add(cv)
    db_session.flush()
    now = datetime.now(UTC)
    db_session.add(
        ValidationRun(
            validation_id=cv.id,
            stream_id=ids["stream_id"],
            run_id="r-old",
            status="OK",
            validation_stage="POLL",
            message="old",
            latency_ms=12,
            created_at=now - timedelta(days=200),
        )
    )
    db_session.add(
        ValidationRun(
            validation_id=cv.id,
            stream_id=ids["stream_id"],
            run_id="r-new",
            status="OK",
            validation_stage="POLL",
            message="new",
            latency_ms=12,
            created_at=now - timedelta(days=1),
        )
    )
    db_session.commit()

    outcomes = run_cleanup(db_session, categories=["runtime_metrics"], dry_run=False)
    assert outcomes[0].status == "ok"
    assert outcomes[0].deleted_count >= 1
    remaining = [r.run_id for r in db_session.query(ValidationRun).all()]
    assert "r-new" in remaining
    assert "r-old" not in remaining


def test_cleanup_preview_cache_is_not_applicable(db_session: Session) -> None:
    _seed_pipeline(db_session)
    outcomes = run_cleanup(db_session, categories=["preview_cache"], dry_run=False)
    assert outcomes[0].status == "not_applicable"
    assert outcomes[0].deleted_count == 0


def test_cleanup_backup_temp_files_only_old_temp_unlink(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_pipeline(db_session)
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    fresh = backup_dir / "fresh.bak"
    fresh.write_text("x")
    old_tmp = backup_dir / "old.tmp"
    old_tmp.write_text("y")
    archive = backup_dir / "real-archive.json"
    archive.write_text("{}")

    very_old = (datetime.now(UTC) - timedelta(days=30)).timestamp()
    os.utime(old_tmp, (very_old, very_old))

    monkeypatch.setenv("GDC_BACKUP_TEMP_DIRS", str(backup_dir))

    row = get_retention_policy_row(db_session)
    row.backup_temp_retention_days = 7
    db_session.commit()

    outcomes = run_cleanup(db_session, categories=["backup_temp"], dry_run=False)
    assert outcomes[0].status == "ok"
    assert outcomes[0].deleted_count == 1
    assert not old_tmp.exists()
    assert fresh.exists()
    assert archive.exists()


def test_cleanup_never_touches_checkpoints_or_config(db_session: Session) -> None:
    ids = _seed_pipeline(db_session)
    now = datetime.now(UTC)
    _add_log(db_session, ids=ids, created_at=now - timedelta(days=100))
    db_session.commit()
    cp_before = (
        db_session.query(Checkpoint).filter(Checkpoint.stream_id == ids["stream_id"]).one()
    )
    cp_value = dict(cp_before.checkpoint_value_json or {})

    run_cleanup(db_session, categories=list(CATEGORIES), dry_run=False)

    db_session.expire_all()
    cp_after = (
        db_session.query(Checkpoint).filter(Checkpoint.stream_id == ids["stream_id"]).one()
    )
    assert dict(cp_after.checkpoint_value_json or {}) == cp_value
    assert db_session.query(Stream).filter(Stream.id == ids["stream_id"]).count() == 1
    assert db_session.query(Route).filter(Route.id == ids["route_id"]).count() == 1
    assert db_session.query(Destination).filter(Destination.id == ids["dest_id"]).count() == 1


def test_run_cleanup_endpoint_records_audit_and_status(client: TestClient, db_session: Session) -> None:
    ids = _seed_pipeline(db_session)
    now = datetime.now(UTC)
    _add_log(db_session, ids=ids, created_at=now - timedelta(days=60))
    db_session.commit()

    r = client.post(
        "/api/v1/admin/retention-policy/run",
        json={"categories": ["logs"], "dry_run": False},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is False
    outcomes = {o["category"]: o for o in body["outcomes"]}
    assert outcomes["logs"]["status"] == "ok"
    assert outcomes["logs"]["deleted_count"] == 1
    assert body["policy"]["logs"]["last_status"] == "ok"
    assert body["policy"]["logs"]["last_deleted_count"] == 1
    assert body["policy"]["logs"]["next_cleanup_at"] is not None

    audit = client.get("/api/v1/admin/audit-log?limit=20").json()
    actions = [item["action"] for item in audit["items"]]
    assert "RETENTION_CLEANUP_EXECUTED" in actions


def test_collect_due_categories(db_session: Session) -> None:
    _seed_pipeline(db_session)
    row = get_retention_policy_row(db_session)
    now = datetime.now(UTC)
    row.logs_next_cleanup_at = now - timedelta(minutes=5)
    row.runtime_metrics_next_cleanup_at = now + timedelta(hours=1)
    row.preview_cache_next_cleanup_at = None
    row.backup_temp_next_cleanup_at = now + timedelta(hours=1)
    db_session.commit()
    due = collect_due_categories(row, now=now)
    assert "logs" in due
    assert "preview_cache" in due
    assert "runtime_metrics" not in due
    assert "backup_temp" not in due
