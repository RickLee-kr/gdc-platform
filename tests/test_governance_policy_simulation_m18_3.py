"""M18.3 Policy Simulation — dry-run evaluation against sample events."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.classification.metrics import CLASSIFICATION_COMPLETE_STAGE
from app.database import get_db, get_db_read_bounded
from app.logs.models import DeliveryLog
from tests.test_stream_runner_e2e import _seed_stream_runtime


def _governance_policies_app() -> FastAPI:
    from app.governance.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/governance")
    return app


@pytest.fixture
def governance_policies_client(db_session: Session) -> TestClient:
    app = _governance_policies_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    return TestClient(app)


def _sample_policy_body(**overrides) -> dict:
    body = {
        "name": "Customer Data Protection",
        "description": "Protect customer PII",
        "category": "DATA_PROTECTION",
        "status": "DRAFT",
        "policy_json": {
            "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
            "actions": [{"type": "quarantine"}],
        },
    }
    body.update(overrides)
    return body


def _simulate_body(**overrides) -> dict:
    body = {
        "policy_json": {
            "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
            "actions": [{"type": "quarantine"}],
        },
        "sample_events": [{"classification": "RESTRICTED", "user": "john"}],
    }
    body.update(overrides)
    return body


def _seed_classification_logs(
    db_session: Session,
    *,
    stream_id: int,
    levels: list[str],
) -> None:
    now = datetime.now(timezone.utc)
    for idx, level in enumerate(levels):
        db_session.add(
            DeliveryLog(
                stream_id=stream_id,
                stage=CLASSIFICATION_COMPLETE_STAGE,
                level="INFO",
                status="OK",
                message="classification complete",
                payload_sample={"classification_level": level, "user": f"user-{idx}"},
                created_at=now - timedelta(hours=1, minutes=idx),
            )
        )


def test_simulate_equals_match(governance_policies_client: TestClient) -> None:
    resp = governance_policies_client.post("/api/v1/governance/policies/simulate", json=_simulate_body())
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["matched"] is True
    assert events[0]["actions"] == ["quarantine"]
    assert events[0]["reason"] == "classification equals RESTRICTED"


def test_simulate_not_equals_match(governance_policies_client: TestClient) -> None:
    body = _simulate_body(
        policy_json={
            "conditions": [{"field": "classification", "operator": "not_equals", "value": "PUBLIC"}],
            "actions": [{"type": "audit_only"}],
        },
        sample_events=[{"classification": "RESTRICTED"}],
    )
    resp = governance_policies_client.post("/api/v1/governance/policies/simulate", json=body)
    assert resp.status_code == 200
    event = resp.json()["events"][0]
    assert event["matched"] is True
    assert event["actions"] == ["audit_only"]
    assert "does not equal" in event["reason"]


def test_simulate_contains_match(governance_policies_client: TestClient) -> None:
    body = _simulate_body(
        policy_json={
            "conditions": [{"field": "field", "operator": "contains", "value": "email"}],
            "actions": [{"type": "mask"}],
        },
        sample_events=[{"field": "$.user.email"}],
    )
    resp = governance_policies_client.post("/api/v1/governance/policies/simulate", json=body)
    assert resp.status_code == 200
    event = resp.json()["events"][0]
    assert event["matched"] is True
    assert event["actions"] == ["mask"]
    assert "contains" in event["reason"]


def test_simulate_multiple_events(governance_policies_client: TestClient) -> None:
    body = _simulate_body(
        sample_events=[
            {"classification": "RESTRICTED"},
            {"classification": "PUBLIC"},
            {"classification": "RESTRICTED", "user": "jane"},
        ],
    )
    resp = governance_policies_client.post("/api/v1/governance/policies/simulate", json=body)
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 3
    assert events[0]["matched"] is True
    assert events[1]["matched"] is False
    assert events[1]["actions"] == []
    assert events[2]["matched"] is True


def test_simulate_invalid_json(governance_policies_client: TestClient) -> None:
    body = _simulate_body(
        policy_json={
            "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
            "actions": [],
        },
    )
    resp = governance_policies_client.post("/api/v1/governance/policies/simulate", json=body)
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "GOVERNANCE_POLICY_SIMULATION"

    bad_events = _simulate_body(sample_events=[{"classification": "RESTRICTED"}, "not-an-object"])
    resp2 = governance_policies_client.post("/api/v1/governance/policies/simulate", json=bad_events)
    assert resp2.status_code in (400, 422)


def test_simulate_saved_policy(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _seed_classification_logs(db_session, stream_id=stream_id, levels=["RESTRICTED", "PUBLIC"])
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body())
    policy_id = create.json()["policy"]["id"]
    assign = governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={"assignments": [{"stream_id": stream_id, "enabled": True}]},
    )
    assert assign.status_code == 200

    explicit = governance_policies_client.post(
        f"/api/v1/governance/policies/{policy_id}/simulate",
        json={"sample_events": [{"classification": "RESTRICTED", "user": "john"}]},
    )
    assert explicit.status_code == 200
    assert explicit.json()["events"][0]["matched"] is True

    recent = governance_policies_client.post(
        f"/api/v1/governance/policies/{policy_id}/simulate",
        json={"sample_events": []},
    )
    assert recent.status_code == 200
    recent_events = recent.json()["events"]
    assert len(recent_events) >= 1
    assert any(e["matched"] for e in recent_events)

    missing = governance_policies_client.post(
        "/api/v1/governance/policies/99999/simulate",
        json={"sample_events": [{"classification": "RESTRICTED"}]},
    )
    assert missing.status_code == 404
