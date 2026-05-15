"""Checkpoint trace read APIs — correlation from committed delivery_logs."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from tests.test_stream_runner_e2e import _FakePoller, _FakeWebhookSender, _build_runner, _seed_stream_runtime


@pytest.fixture()
def trace_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_checkpoint_trace_and_history_endpoints(trace_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])
    poller = _FakePoller(response={"items": [{"id": "evt-ct-api", "message": "hello", "vendor": "MappedVendor"}]})
    runner = _build_runner(poller=poller, webhook_sender=_FakeWebhookSender())
    runner.run(context, db=db_session)

    run_id = (
        db_session.query(DeliveryLog.run_id)
        .filter(DeliveryLog.stage == "run_complete", DeliveryLog.stream_id == seeded["stream_id"])
        .scalar()
    )
    assert run_id is not None

    res = trace_client.get("/api/v1/runtime/checkpoints/trace", params={"run_id": run_id})
    assert res.status_code == 200
    body = res.json()
    assert body["run_id"] == run_id
    assert body["stream_id"] == seeded["stream_id"]
    assert body.get("checkpoint_type") is not None
    assert isinstance(body.get("timeline_events"), list)
    assert len(body["timeline_events"]) >= 1

    res_cp = trace_client.get(f"/api/v1/runtime/runs/{run_id}/checkpoint")
    assert res_cp.status_code == 200
    assert res_cp.json()["run_id"] == run_id

    hist = trace_client.get(f"/api/v1/runtime/checkpoints/streams/{seeded['stream_id']}/history", params={"limit": 10})
    assert hist.status_code == 200
    hbody = hist.json()
    assert hbody["stream_id"] == seeded["stream_id"]
    assert len(hbody["items"]) >= 1


def test_checkpoint_trace_unknown_run_returns_404(trace_client: TestClient) -> None:
    res = trace_client.get(
        "/api/v1/runtime/checkpoints/trace",
        params={"run_id": "00000000-0000-0000-0000-000000000099"},
    )
    assert res.status_code == 404
