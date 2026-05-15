"""Backfill Phase 2: worker dry-run, progress events, start/cancel APIs, stream lock."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.backfill.models import BackfillProgressEvent
from app.backfill.schemas import BackfillJobCreate
from app.backfill import service
from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.main import app
from tests.test_backfill_foundation import _seed_stream_with_checkpoint


@pytest.fixture(autouse=True)
def _reset_coordinator() -> None:
    service.get_coordinator().reset_ephemeral_for_tests()
    yield
    service.get_coordinator().reset_ephemeral_for_tests()


@pytest.fixture
def client(db_session: Session):
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        with TestClient(app) as tc:
            yield tc
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_job_created_event_on_create(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    res = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "INITIAL_FILL", "requested_by": "pytest"},
    )
    assert res.status_code == 201, res.text
    job_id = res.json()["id"]
    ev = client.get(f"/api/v1/backfill/jobs/{job_id}/events")
    assert ev.status_code == 200
    rows = ev.json()
    assert len(rows) >= 1
    assert rows[0]["event_type"] == "job_created"
    assert rows[0]["level"] == "INFO"


def test_start_pending_job_dry_run_stays_running(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    c = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "TIME_RANGE_REPLAY", "requested_by": "a"},
    )
    job_id = c.json()["id"]
    s = client.post(f"/api/v1/backfill/jobs/{job_id}/start")
    assert s.status_code == 200, s.text
    body = s.json()
    assert body["status"] == "RUNNING"
    ev = client.get(f"/api/v1/backfill/jobs/{job_id}/events")
    types = [e["event_type"] for e in ev.json()]
    assert "job_started" in types
    assert "chunk_started" in types
    assert "checkpoint_snapshot_used" in types
    assert "chunk_completed" in types
    assert "job_completed" not in types


def test_start_pending_dry_run_complete_marks_completed(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    c = client.post(
        "/api/v1/backfill/jobs",
        json={
            "stream_id": stream.id,
            "backfill_mode": "INITIAL_FILL",
            "requested_by": "b",
            "runtime_options_json": {"dry_run_complete": True},
        },
    )
    job_id = c.json()["id"]
    s = client.post(f"/api/v1/backfill/jobs/{job_id}/start")
    assert s.status_code == 200, s.text
    assert s.json()["status"] == "COMPLETED"
    ev = client.get(f"/api/v1/backfill/jobs/{job_id}/events")
    types = [e["event_type"] for e in ev.json()]
    assert "job_completed" in types


def test_start_rejects_invalid_status(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    c = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "OBJECT_REPLAY", "requested_by": "c"},
    )
    job_id = c.json()["id"]
    assert client.post(f"/api/v1/backfill/jobs/{job_id}/start").status_code == 200
    again = client.post(f"/api/v1/backfill/jobs/{job_id}/start")
    assert again.status_code == 409


def test_prevent_concurrent_running_backfills_same_stream(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    j1 = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "FILE_REPLAY", "requested_by": "d"},
    ).json()["id"]
    j2 = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "FILE_REPLAY", "requested_by": "e"},
    ).json()["id"]
    assert client.post(f"/api/v1/backfill/jobs/{j1}/start").status_code == 200
    blocked = client.post(f"/api/v1/backfill/jobs/{j2}/start")
    assert blocked.status_code == 409
    assert client.get(f"/api/v1/backfill/jobs/{j2}").json()["status"] == "PENDING"
    ev2 = client.get(f"/api/v1/backfill/jobs/{j2}/events").json()
    warns = [e for e in ev2 if e.get("error_code") == "CONCURRENT_BACKFILL_ACTIVE"]
    assert len(warns) == 1
    assert warns[0]["level"] == "WARNING"


def test_cancel_pending_job(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    job_id = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "INITIAL_FILL", "requested_by": "f"},
    ).json()["id"]
    x = client.post(f"/api/v1/backfill/jobs/{job_id}/cancel")
    assert x.status_code == 200
    assert x.json()["status"] == "CANCELLED"
    ev = client.get(f"/api/v1/backfill/jobs/{job_id}/events").json()
    types = [e["event_type"] for e in ev]
    assert types.count("cancellation_requested") >= 1
    assert types.count("job_cancelled") >= 1


def test_cancel_running_job_ends_cancelled(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    job_id = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "CHECKPOINT_REWIND", "requested_by": "g"},
    ).json()["id"]
    assert client.post(f"/api/v1/backfill/jobs/{job_id}/start").status_code == 200
    x = client.post(f"/api/v1/backfill/jobs/{job_id}/cancel")
    assert x.status_code == 200
    assert x.json()["status"] == "CANCELLED"
    ev = client.get(f"/api/v1/backfill/jobs/{job_id}/events").json()
    assert any(e["event_type"] == "cancellation_requested" for e in ev)
    assert any(e["event_type"] == "job_cancelled" for e in ev)


def test_list_events_ordered_by_created_at(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    job_id = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "INITIAL_FILL", "requested_by": "h"},
    ).json()["id"]
    client.post(f"/api/v1/backfill/jobs/{job_id}/start")
    rows = client.get(f"/api/v1/backfill/jobs/{job_id}/events").json()
    ts = [r["created_at"] for r in rows]
    assert ts == sorted(ts)


def test_checkpoints_untouched_after_start(client: TestClient, db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    before = dict(db_session.get(Checkpoint, stream.id).checkpoint_value_json)  # type: ignore[union-attr]
    job_id = client.post(
        "/api/v1/backfill/jobs",
        json={"stream_id": stream.id, "backfill_mode": "INITIAL_FILL", "requested_by": "i"},
    ).json()["id"]
    assert client.post(f"/api/v1/backfill/jobs/{job_id}/start").status_code == 200
    db_session.expire_all()
    after = db_session.get(Checkpoint, stream.id)
    assert after is not None
    assert after.checkpoint_value_json == before


def test_progress_rows_persisted(db_session: Session) -> None:
    stream = _seed_stream_with_checkpoint(db_session)
    job = service.create_backfill_job(
        db_session, BackfillJobCreate(stream_id=stream.id, backfill_mode="INITIAL_FILL", requested_by="j")
    )
    q = select(func.count()).select_from(BackfillProgressEvent).where(BackfillProgressEvent.backfill_job_id == job.id)
    n = int(db_session.execute(q).scalar_one())
    assert n >= 1
