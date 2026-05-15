"""Tests for ``app.retention`` operational cleanup (PostgreSQL)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from fastapi.testclient import TestClient

from app.backfill.models import BackfillJob, BackfillProgressEvent
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.platform_admin.repository import get_retention_policy_row
from app.retention.config import effective_retention_policies
from app.retention.scheduler import OperationalRetentionScheduler
from app.retention.service import (
    preview_retention,
    retention_cutoff,
    run_operational_retention,
    supplement_due,
)
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream
from app.validation.models import ContinuousValidation, ValidationRun

UTC = timezone.utc


def test_supplement_due_respects_meta_and_scheduler_flag(db_session: Session) -> None:
    row = get_retention_policy_row(db_session)
    row.cleanup_scheduler_enabled = False
    row.operational_retention_meta = {}
    db_session.commit()
    assert supplement_due(row) is False

    row.cleanup_scheduler_enabled = True
    db_session.commit()
    assert supplement_due(row) is True

    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    row.operational_retention_meta = {"supplement_next_after": future}
    db_session.commit()
    assert supplement_due(row) is False


@pytest.fixture
def client(db_session: Session):
    def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _seed_stream(db: Session) -> dict[str, int]:
    connector = Connector(name="op-ret", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="op-ret-stream",
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
        name="op-ret-d",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.invalid/h"},
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
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db.commit()
    return {"stream_id": stream.id, "route_id": route.id, "dest_id": dest.id, "connector_id": connector.id}


def test_retention_cutoff_respects_days() -> None:
    c = retention_cutoff(days=7)
    assert c < datetime.now(UTC)
    assert datetime.now(UTC) - c >= timedelta(days=7) - timedelta(minutes=1)


def test_preview_counts_old_delivery_logs(db_session: Session) -> None:
    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.logs_retention_days = 30
    db_session.commit()
    now = datetime.now(UTC)
    db_session.add(
        DeliveryLog(
            connector_id=ids["connector_id"],
            stream_id=ids["stream_id"],
            route_id=ids["route_id"],
            destination_id=ids["dest_id"],
            stage="run_complete",
            level="INFO",
            status="OK",
            message="x",
            payload_sample={},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=None,
            created_at=now - timedelta(days=40),
        )
    )
    db_session.commit()
    prev = preview_retention(db_session, row)
    dl = next(p for p in prev if p.table == "delivery_logs")
    assert dl.rows_eligible >= 1
    assert dl.oldest_row_timestamp is not None


def test_active_backfill_cancelling_job_not_deleted(db_session: Session) -> None:
    """CANCELLING must be protected the same as RUNNING (034 safety)."""

    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.cleanup_batch_size = 50
    db_session.commit()
    now = datetime.now(UTC)
    job_old = BackfillJob(
        stream_id=ids["stream_id"],
        source_type="HTTP_API_POLLING",
        status="CANCELLING",
        backfill_mode="INITIAL_FILL",
        requested_by="t",
        created_at=now - timedelta(days=100),
        source_config_snapshot_json={},
        checkpoint_snapshot_json={},
        runtime_options_json={},
        progress_json={},
    )
    db_session.add(job_old)
    db_session.commit()
    rid = int(job_old.id)

    run_operational_retention(
        db_session,
        row,
        dry_run=False,
        actor_username="pytest",
        trigger="test",
        tables={"backfill_jobs"},
    )
    remaining = {j.id: j.status for j in db_session.query(BackfillJob).all()}
    assert rid in remaining
    assert remaining[rid] == "CANCELLING"


def test_retention_large_volume_delivery_logs_batch_delete(db_session: Session) -> None:
    """Many eligible delivery_logs rows are cleared via repeated batch commits (034)."""

    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.logs_enabled = True
    row.logs_retention_days = 30
    row.cleanup_batch_size = 250
    db_session.commit()
    old = datetime.now(UTC) - timedelta(days=90)
    n = 750
    payload = {"input_events": 1, "event_count": 1, "success_events": 1}
    mappings = [
        {
            "connector_id": ids["connector_id"],
            "stream_id": ids["stream_id"],
            "route_id": ids["route_id"],
            "destination_id": ids["dest_id"],
            "stage": "run_complete",
            "level": "INFO",
            "status": "OK",
            "message": "bulk",
            "payload_sample": payload,
            "retry_count": 0,
            "http_status": None,
            "latency_ms": None,
            "error_code": None,
            "created_at": old,
        }
        for _ in range(n)
    ]
    db_session.bulk_insert_mappings(DeliveryLog, mappings)
    db_session.commit()
    assert db_session.query(DeliveryLog).count() == n

    out = run_operational_retention(
        db_session,
        row,
        dry_run=False,
        actor_username="pytest",
        trigger="test",
        tables={"delivery_logs"},
    )
    dl = next(o for o in out if o.table == "delivery_logs")
    assert dl.deleted_count >= n
    assert db_session.query(DeliveryLog).count() == 0


def test_active_backfill_jobs_not_deleted(db_session: Session) -> None:
    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.cleanup_batch_size = 50
    db_session.commit()
    now = datetime.now(UTC)
    job_old_running = BackfillJob(
        stream_id=ids["stream_id"],
        source_type="HTTP_API_POLLING",
        status="RUNNING",
        backfill_mode="INITIAL_FILL",
        requested_by="t",
        created_at=now - timedelta(days=100),
        source_config_snapshot_json={},
        checkpoint_snapshot_json={},
        runtime_options_json={},
        progress_json={},
    )
    job_old_done = BackfillJob(
        stream_id=ids["stream_id"],
        source_type="HTTP_API_POLLING",
        status="COMPLETED",
        backfill_mode="INITIAL_FILL",
        requested_by="t",
        created_at=now - timedelta(days=100),
        source_config_snapshot_json={},
        checkpoint_snapshot_json={},
        runtime_options_json={},
        progress_json={},
    )
    db_session.add_all([job_old_running, job_old_done])
    db_session.commit()
    rid_running = int(job_old_running.id)
    rid_done = int(job_old_done.id)

    out = run_operational_retention(
        db_session,
        row,
        dry_run=False,
        actor_username="pytest",
        trigger="test",
        tables={"backfill_jobs"},
    )
    by_t = {o.table: o for o in out}
    assert by_t["backfill_jobs"].deleted_count >= 1
    remaining = {j.id: j.status for j in db_session.query(BackfillJob).all()}
    assert rid_running in remaining
    assert rid_done not in remaining


def test_backfill_progress_respects_active_parent(db_session: Session) -> None:
    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.cleanup_batch_size = 20
    db_session.commit()
    now = datetime.now(UTC)
    job = BackfillJob(
        stream_id=ids["stream_id"],
        source_type="HTTP_API_POLLING",
        status="RUNNING",
        backfill_mode="INITIAL_FILL",
        requested_by="t",
        created_at=now - timedelta(days=1),
        source_config_snapshot_json={},
        checkpoint_snapshot_json={},
        runtime_options_json={},
        progress_json={},
    )
    db_session.add(job)
    db_session.flush()
    ev = BackfillProgressEvent(
        backfill_job_id=job.id,
        stream_id=ids["stream_id"],
        event_type="tick",
        level="INFO",
        message="m",
        created_at=now - timedelta(days=90),
    )
    db_session.add(ev)
    db_session.commit()

    run_operational_retention(
        db_session,
        row,
        dry_run=False,
        actor_username="pytest",
        trigger="test",
        tables={"backfill_progress_events"},
    )
    assert db_session.query(BackfillProgressEvent).filter(BackfillProgressEvent.id == ev.id).count() == 1


def test_dry_run_preview_and_run_no_delete(db_session: Session) -> None:
    ids = _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.logs_enabled = True
    db_session.commit()
    now = datetime.now(UTC)
    db_session.add(
        DeliveryLog(
            connector_id=ids["connector_id"],
            stream_id=ids["stream_id"],
            route_id=ids["route_id"],
            destination_id=ids["dest_id"],
            stage="run_complete",
            level="INFO",
            status="OK",
            message="x",
            payload_sample={},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=None,
            created_at=now - timedelta(days=50),
        )
    )
    db_session.commit()
    prev = preview_retention(db_session, row)
    assert any(p.rows_eligible >= 1 for p in prev if p.table == "delivery_logs")

    run_operational_retention(
        db_session,
        row,
        dry_run=True,
        actor_username="pytest",
        trigger="test",
        tables={"delivery_logs"},
    )
    assert db_session.query(DeliveryLog).count() == 1


def test_effective_policies_merges_row(db_session: Session) -> None:
    row = get_retention_policy_row(db_session)
    row.logs_retention_days = 14
    row.runtime_metrics_retention_days = 60
    db_session.commit()
    pol = effective_retention_policies(row)
    assert pol["delivery_logs_days"] == 14
    assert pol["runtime_metrics_days"] == 60


def test_supplement_scheduler_trigger_once(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED", True)
    _seed_stream(db_session)
    row = get_retention_policy_row(db_session)
    row.operational_retention_meta = {}
    row.cleanup_scheduler_enabled = True
    db_session.commit()

    sched = OperationalRetentionScheduler(tick_seconds=1.0)
    sched.trigger_once()
    sched.stop()


def test_retention_preview_http(client: TestClient, db_session: Session) -> None:
    _seed_stream(db_session)
    r = client.get("/api/v1/retention/preview")
    assert r.status_code == 200
    body = r.json()
    assert "tables" in body
    assert isinstance(body["tables"], list)


def test_validation_runs_batch_delete(db_session: Session) -> None:
    ids = _seed_stream(db_session)
    cv = ContinuousValidation(
        name="cvx",
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
            run_id="old",
            status="OK",
            validation_stage="POLL",
            message="m",
            latency_ms=1,
            created_at=now - timedelta(days=400),
        )
    )
    db_session.commit()
    row = get_retention_policy_row(db_session)
    row.cleanup_batch_size = 5
    row.runtime_metrics_enabled = True
    db_session.commit()
    run_operational_retention(
        db_session,
        row,
        dry_run=False,
        actor_username="pytest",
        trigger="test",
        tables={"validation_runs"},
    )
    assert db_session.query(ValidationRun).count() == 0
