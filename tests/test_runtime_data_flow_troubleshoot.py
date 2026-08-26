"""Data Flow Troubleshooter API — GET /runtime/streams/{id}/troubleshoot."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.delivery.process_circuit_breaker import (
    get_process_destination_circuit_breaker,
    reset_process_destination_circuit_breaker_for_tests,
)
from app.logs.models import DeliveryLog
from app.main import app
from tests.test_stream_runner_e2e import _seed_stream_runtime


@pytest.fixture
def troubleshoot_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    reset_process_destination_circuit_breaker_for_tests()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        reset_process_destination_circuit_breaker_for_tests()


def test_troubleshoot_healthy_idle_stream(troubleshoot_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])

    response = troubleshoot_client.get(f"/api/v1/runtime/streams/{stream_id}/troubleshoot")
    assert response.status_code == 200
    body = response.json()
    assert body["stream_id"] == stream_id
    assert body["health"] in ("IDLE", "HEALTHY")
    assert body["current_issue"]
    assert body["diagnosis_stage"] in (
        "none",
        "source_fetch",
        "extraction",
        "transform",
        "protection",
        "classification",
        "policy",
        "destination",
        "checkpoint",
    )
    assert len(body["stages"]) == 8
    assert body["checkpoint_state"] in ("safe", "held", "unknown")
    assert any(a["id"] == "view_evidence" for a in body["actions"])


def test_troubleshoot_destination_http_failure(troubleshoot_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    route_id = int(seeded["route_ids"][0])
    destination_id = int(seeded["destination_ids"][0])

    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            stage="route_send_failed",
            level="ERROR",
            status="FAILED",
            message="Destination returned HTTP 503",
            payload_sample={},
            retry_count=1,
            http_status=503,
            error_code="DESTINATION_HTTP_ERROR",
            created_at=utcnow(),
        )
    )
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            route_id=route_id,
            destination_id=destination_id,
            stage="checkpoint_held",
            level="WARN",
            status="HELD",
            message="checkpoint held; destination failure",
            payload_sample={},
            created_at=utcnow(),
        )
    )
    db_session.commit()

    response = troubleshoot_client.get(f"/api/v1/runtime/streams/{stream_id}/troubleshoot")
    assert response.status_code == 200
    body = response.json()
    assert body["health"] in ("DEGRADED", "UNHEALTHY")
    assert "503" in body["current_issue"] or "HTTP" in body["current_issue"]
    assert body["diagnosis_stage"] == "destination"
    assert body["checkpoint_state"] == "held"
    assert any(e["kind"] == "delivery_log" for e in body["evidence"])
    assert any(a["id"] == "test_destination" for a in body["actions"])
    dest_stage = next(s for s in body["stages"] if s["stage"] == "destination")
    assert dest_stage["status"] == "problem"


def test_troubleshoot_source_fetch_failure(troubleshoot_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])

    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage="source_fetch_failed",
            level="ERROR",
            status="FAILED",
            message="HTTP 429 Too Many Requests",
            payload_sample={},
            http_status=429,
            error_code="SOURCE_RATE_LIMIT",
            created_at=utcnow(),
        )
    )
    db_session.commit()

    body = troubleshoot_client.get(f"/api/v1/runtime/streams/{stream_id}/troubleshoot").json()
    assert body["diagnosis_stage"] == "source_fetch"
    assert "429" in body["current_issue"] or "HTTP" in body["current_issue"]


def test_troubleshoot_circuit_open(troubleshoot_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])

    breaker = get_process_destination_circuit_breaker()
    breaker.force_open_for_tests(destination_id)

    body = troubleshoot_client.get(f"/api/v1/runtime/streams/{stream_id}/troubleshoot").json()
    assert body["diagnosis_stage"] == "destination"
    assert "circuit" in body["current_issue"].lower()
    assert any(e["kind"] == "circuit_breaker" for e in body["evidence"])
    assert "probe" in body["recovery"].lower() or "circuit" in body["recovery"].lower()


def test_troubleshoot_not_found(troubleshoot_client: TestClient) -> None:
    response = troubleshoot_client.get("/api/v1/runtime/streams/999999991/troubleshoot")
    assert response.status_code == 404
