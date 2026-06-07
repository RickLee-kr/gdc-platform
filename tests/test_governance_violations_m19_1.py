"""M19.1 Violation Center — policy-centric violation feed."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db_read_bounded
from app.governance_policies.models import (
    POLICY_STATUS_ACTIVE,
    GovernancePolicy,
    StreamPolicyAssignment,
)
from app.quarantine.models import (
    QUARANTINE_SOURCE_POLICY,
    QUARANTINE_STATUS_QUARANTINED,
    QUARANTINE_STATUS_RELEASED,
    StreamQuarantineEvent,
)
from app.replay.models import REPLAY_STATUS_REPLAYED, StreamReplayEvent
from tests.test_stream_runner_e2e import _seed_stream_runtime


def _governance_app() -> FastAPI:
    from app.governance.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/governance")
    return app


@pytest.fixture
def governance_client(db_session: Session) -> TestClient:
    app = _governance_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    return TestClient(app)


def _create_policy(db_session: Session, *, name: str, stream_id: int) -> GovernancePolicy:
    now = datetime.now(timezone.utc)
    row = GovernancePolicy(
        name=name,
        description=None,
        category="DATA_PROTECTION",
        status=POLICY_STATUS_ACTIVE,
        policy_json={
            "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
            "actions": [{"type": "quarantine"}],
        },
        version=1,
        activated_at=now,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    db_session.add(StreamPolicyAssignment(stream_id=stream_id, policy_id=row.id, enabled=True))
    db_session.commit()
    return row


def _create_quarantine(
    db_session: Session,
    *,
    stream_id: int,
    status: str = QUARANTINE_STATUS_QUARANTINED,
    policy_names: list[str] | None = None,
    reason: str = "policy:RESTRICTED Rule",
    created_at: datetime | None = None,
) -> StreamQuarantineEvent:
    now = created_at or datetime.now(timezone.utc)
    row = StreamQuarantineEvent(
        stream_id=int(stream_id),
        quarantine_reason=reason,
        quarantine_source=QUARANTINE_SOURCE_POLICY,
        status=status,
        protected_payload_json={"events": [{"classification": "RESTRICTED"}]},
        metadata_json={
            "event_count": 1,
            "policy_names": policy_names or ["RESTRICTED Rule"],
        },
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_list_violations_empty(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/violations")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["violations"] == []
    assert body["window"] == "24h"


def test_list_violations(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy = _create_policy(db_session, name="Customer Data Protection", stream_id=stream_id)
    _create_quarantine(
        db_session,
        stream_id=stream_id,
        policy_names=["Customer Data Protection"],
        reason="policy:Customer Data Protection",
    )

    resp = governance_client.get("/api/v1/governance/violations?window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    row = body["violations"][0]
    assert row["policy_name"] == "Customer Data Protection"
    assert row["policy_id"] == policy.id
    assert row["stream_id"] == stream_id
    assert row["status"] == "QUARANTINED"
    assert row["severity"] == "HIGH"
    assert row["id"].startswith("q-")


def test_list_violations_filter_by_policy(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy_a = _create_policy(db_session, name="Policy A", stream_id=stream_id)
    _create_policy(db_session, name="Policy B", stream_id=stream_id)
    _create_quarantine(
        db_session,
        stream_id=stream_id,
        policy_names=["Policy A"],
        reason="policy:Policy A",
    )
    _create_quarantine(
        db_session,
        stream_id=stream_id,
        policy_names=["Policy B"],
        reason="policy:Policy B",
    )

    resp = governance_client.get(f"/api/v1/governance/violations?policy_id={policy_a.id}")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["violations"][0]["policy_name"] == "Policy A"


def test_list_violations_filter_by_status(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="Employee PII", stream_id=stream_id)
    pending = _create_quarantine(db_session, stream_id=stream_id, status=QUARANTINE_STATUS_QUARANTINED)
    released = _create_quarantine(db_session, stream_id=stream_id, status=QUARANTINE_STATUS_RELEASED)
    _ = pending, released

    resp = governance_client.get("/api/v1/governance/violations?status=RELEASED")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["violations"][0]["status"] == "RELEASED"


def test_violation_detail(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy = _create_policy(db_session, name="Customer Data Protection", stream_id=stream_id)
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        policy_names=["Customer Data Protection"],
    )

    resp = governance_client.get(f"/api/v1/governance/violations/q-{q_row.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["violation"]["policy_id"] == policy.id
    assert body["policy_summary"]["policy_name"] == "Customer Data Protection"
    assert body["related_quarantine"]["quarantine_event_id"] == q_row.id
    assert body["related_quarantine"]["status"] == QUARANTINE_STATUS_QUARANTINED


def test_violation_detail_replayed_status(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    _create_policy(db_session, name="Replay Policy", stream_id=stream_id)
    now = datetime.now(timezone.utc)
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        status=QUARANTINE_STATUS_RELEASED,
        created_at=now - timedelta(hours=2),
    )
    db_session.add(
        StreamReplayEvent(
            stream_id=stream_id,
            destination_id=destination_id,
            route_id=route_id,
            delivery_kind="base_route",
            status=REPLAY_STATUS_REPLAYED,
            protected_payload_json={"events": []},
            delivery_context_json={},
            event_count=1,
            created_at=now - timedelta(hours=1),
            updated_at=now,
            last_replay_at=now - timedelta(minutes=30),
        )
    )
    db_session.commit()

    resp = governance_client.get(f"/api/v1/governance/violations/q-{q_row.id}?window=24h")
    assert resp.status_code == 200
    assert resp.json()["violation"]["status"] == "REPLAYED"
    assert len(resp.json()["related_replays"]) >= 1


def test_violation_detail_not_found(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/violations/q-999999")
    assert resp.status_code == 404
