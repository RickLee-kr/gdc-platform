"""Manual replay of failed delivery_logs rows (dead-letter MVP)."""

from __future__ import annotations

from types import MethodType
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.destinations.adapters.registry import DestinationAdapterRegistry
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.runtime import replay_service
from tests.test_stream_runner_e2e import _FakeWebhookSender, _seed_stream_runtime


@pytest.fixture
def client(db_session: Session):
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _insert_failed_log(
    db: Session,
    *,
    seeded: dict[str, Any],
    events: list[dict[str, Any]] | None,
    route_enabled: bool = True,
) -> DeliveryLog:
    route_id = int(seeded["route_ids"][0])
    if not route_enabled:
        route = db.query(Route).filter(Route.id == route_id).first()
        assert route is not None
        route.enabled = False
        db.add(route)
        db.flush()

    row = DeliveryLog(
        connector_id=None,
        stream_id=int(seeded["stream_id"]),
        route_id=route_id,
        destination_id=int(seeded["destination_ids"][0]),
        stage="route_send_failed",
        level="ERROR",
        status="FAILED",
        message="webhook send failed",
        payload_sample={
            "stage": "route_send_failed",
            "error_type": "RuntimeError",
            "replay_events": events or [],
        },
        retry_count=0,
        error_code="RuntimeError",
        run_id="run-replay-test",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _checkpoint_value(db: Session, stream_id: int) -> dict[str, Any]:
    row = db.query(Checkpoint).filter(Checkpoint.stream_id == int(stream_id)).first()
    assert row is not None
    return dict(row.checkpoint_value_json or {})


def test_replay_success(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    events = [{"event_id": "e1", "message": "hello", "vendor": "Acme"}]
    log_row = _insert_failed_log(db_session, seeded=seeded, events=events)
    before_cp = _checkpoint_value(db_session, int(seeded["stream_id"]))

    sender = _FakeWebhookSender()
    registry = DestinationAdapterRegistry(webhook_sender=sender)

    result = replay_service.replay_delivery_log(
        db_session,
        int(log_row.id),
        dry_run=False,
        destination_registry=registry,
    )
    db_session.commit()

    assert result.outcome == "delivered"
    assert len(sender.calls) == 1
    assert sender.calls[0]["events"] == events
    assert replay_service.checkpoint_unchanged(db_session, int(seeded["stream_id"]), before_cp)

    stages = [r.stage for r in db_session.query(DeliveryLog).filter(DeliveryLog.run_id == result.replay_run_id).all()]
    assert "replay_started" in stages
    assert "replay_delivered" in stages


def test_replay_failure(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    events = [{"event_id": "e1", "message": "fail"}]
    log_row = _insert_failed_log(db_session, seeded=seeded, events=events)
    dest_id = int(seeded["destination_ids"][0])
    from app.destinations.models import Destination

    dest = db_session.query(Destination).filter(Destination.id == dest_id).first()
    assert dest is not None
    url = str((dest.config_json or {}).get("url"))
    sender = _FakeWebhookSender(fail_urls={url})
    registry = DestinationAdapterRegistry(webhook_sender=sender)

    result = replay_service.replay_delivery_log(
        db_session,
        int(log_row.id),
        dry_run=False,
        destination_registry=registry,
    )
    db_session.commit()

    assert result.outcome == "failed"
    assert result.error_type == "RuntimeError"
    stages = [r.stage for r in db_session.query(DeliveryLog).filter(DeliveryLog.run_id == result.replay_run_id).all()]
    assert "replay_started" in stages
    assert "replay_failed" in stages


def test_replay_disabled_route_blocked(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    log_row = _insert_failed_log(
        db_session,
        seeded=seeded,
        events=[{"event_id": "e1"}],
        route_enabled=False,
    )

    with pytest.raises(replay_service.ReplayNotEligibleError) as exc:
        replay_service.replay_delivery_log(db_session, int(log_row.id))
    assert exc.value.error_code == "REPLAY_ROUTE_DISABLED"


def test_replay_checkpoint_not_changed(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    log_row = _insert_failed_log(db_session, seeded=seeded, events=[{"event_id": "e1", "message": "x"}])
    before = _checkpoint_value(db_session, int(seeded["stream_id"]))

    sender = _FakeWebhookSender()
    replay_service.replay_delivery_log(
        db_session,
        int(log_row.id),
        destination_registry=DestinationAdapterRegistry(webhook_sender=sender),
    )
    db_session.commit()
    after = _checkpoint_value(db_session, int(seeded["stream_id"]))
    assert after == before


def test_replay_payload_missing_blocked(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    log_row = _insert_failed_log(db_session, seeded=seeded, events=[])

    with pytest.raises(replay_service.ReplayNotEligibleError) as exc:
        replay_service.replay_delivery_log(db_session, int(log_row.id))
    assert exc.value.error_code == "REPLAY_PAYLOAD_INSUFFICIENT"


def test_replay_api_dry_run(client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    log_row = _insert_failed_log(db_session, seeded=seeded, events=[{"event_id": "e1", "message": "dry"}])

    res = client.post(
        f"/api/v1/runtime/replay/delivery-log/{log_row.id}",
        json={"dry_run": True},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "dry_run_ok"
    assert body["dry_run"] is True
    assert body["preview_message_count"] is not None
