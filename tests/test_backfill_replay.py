"""Operational backfill replay: single-request API + StreamRunner integration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.backfill import service
from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from tests.test_stream_runner_e2e import _seed_stream_runtime


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


def _checkpoint_value(db: Session, stream_id: int) -> dict:
    row = db.scalars(select(Checkpoint).where(Checkpoint.stream_id == int(stream_id))).first()
    assert row is not None
    return dict(row.checkpoint_value_json or {})


def test_replay_rejects_inverted_window(client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    sid = int(seeded["stream_id"])
    now = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/backfill/replay",
        json={
            "stream_id": sid,
            "start_time": now.isoformat(),
            "end_time": (now - timedelta(days=1)).isoformat(),
            "dry_run": True,
        },
    )
    assert res.status_code == 400


def test_replay_completes_with_mock_runner(monkeypatch: pytest.MonkeyPatch, client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    sid = int(seeded["stream_id"])

    def _fake_run(self, stream, db=None):  # noqa: ANN001
        assert stream.persist_checkpoint is False
        assert stream.replay_start is not None
        assert stream.replay_end is not None
        return {
            "outcome": "completed",
            "extracted_event_count": 3,
            "delivered_batch_event_count": 2,
            "skipped_delivery_count": 0,
            "checkpoint_updated": False,
            "dry_run": False,
        }

    monkeypatch.setattr("app.backfill.worker.StreamRunner.run", _fake_run)

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=7)
    res = client.post(
        "/api/v1/backfill/replay",
        json={
            "stream_id": sid,
            "start_time": start.isoformat(),
            "end_time": now.isoformat(),
            "dry_run": False,
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "COMPLETED"
    summ = body.get("delivery_summary_json") or {}
    assert summ.get("sent") == 2
    assert summ.get("failed") == 1


def test_replay_preserves_stream_checkpoint(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    sid = int(seeded["stream_id"])
    before = _checkpoint_value(db_session, sid)

    monkeypatch.setattr(
        "app.backfill.worker.StreamRunner.run",
        lambda self, stream, db=None: {  # noqa: ANN001
            "outcome": "completed",
            "extracted_event_count": 2,
            "delivered_batch_event_count": 2,
            "skipped_delivery_count": 0,
            "checkpoint_updated": False,
        },
    )

    now = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/backfill/replay",
        json={
            "stream_id": sid,
            "start_time": (now - timedelta(days=1)).isoformat(),
            "end_time": now.isoformat(),
        },
    )
    assert res.status_code == 201, res.text
    db_session.expire_all()
    after = _checkpoint_value(db_session, sid)
    assert after == before


def test_replay_dry_run_inserts_no_delivery_logs(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(db_session)
    sid = int(seeded["stream_id"])
    before = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == sid).count()

    def _fake_run(self, stream, db=None):  # noqa: ANN001
        assert stream.persist_checkpoint is False
        assert stream.dry_run is True
        return {
            "outcome": "completed",
            "extracted_event_count": 0,
            "delivered_batch_event_count": 0,
            "skipped_delivery_count": 0,
            "checkpoint_updated": False,
            "dry_run": True,
        }

    monkeypatch.setattr("app.backfill.worker.StreamRunner.run", _fake_run)
    now = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/backfill/replay",
        json={
            "stream_id": sid,
            "start_time": (now - timedelta(hours=1)).isoformat(),
            "end_time": now.isoformat(),
            "dry_run": True,
        },
    )
    assert res.status_code == 201, res.text
    db_session.expire_all()
    after = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == sid).count()
    assert after == before


def test_replay_stream_runner_context_preserves_multi_route_fanout(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, db_session: Session
) -> None:
    seeded = _seed_stream_runtime(
        db_session,
        failure_policies=["LOG_AND_CONTINUE", "LOG_AND_CONTINUE"],
    )
    sid = int(seeded["stream_id"])
    captured: dict[str, int] = {}

    def _fake_run(self, stream, db=None):  # noqa: ANN001
        captured["route_count"] = len(stream.routes)
        return {
            "outcome": "completed",
            "extracted_event_count": 2,
            "delivered_batch_event_count": 2,
            "skipped_delivery_count": 0,
            "checkpoint_updated": False,
        }

    monkeypatch.setattr("app.backfill.worker.StreamRunner.run", _fake_run)
    now = datetime.now(timezone.utc)
    res = client.post(
        "/api/v1/backfill/replay",
        json={
            "stream_id": sid,
            "start_time": (now - timedelta(days=1)).isoformat(),
            "end_time": now.isoformat(),
            "dry_run": True,
        },
    )
    assert res.status_code == 201, res.text
    assert captured.get("route_count") == 2
