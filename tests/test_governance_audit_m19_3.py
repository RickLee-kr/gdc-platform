"""M19.3 Governance Audit Trail — lifecycle timeline from existing runtime data."""

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
    QUARANTINE_STATUS_DISCARDED,
    QUARANTINE_STATUS_QUARANTINED,
    QUARANTINE_STATUS_RELEASED,
    StreamQuarantineEvent,
)
from app.replay.models import REPLAY_STATUS_FAILED, REPLAY_STATUS_REPLAYED, StreamReplayEvent
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


def _create_policy(
    db_session: Session,
    *,
    name: str,
    stream_id: int,
    activated_at: datetime | None = None,
) -> GovernancePolicy:
    now = activated_at or datetime.now(timezone.utc)
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
        created_at=now - timedelta(hours=1),
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
    reason: str = "policy:Customer Data Protection",
    created_at: datetime | None = None,
    released_at: datetime | None = None,
    released_by: str | None = None,
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
            "policy_names": policy_names or ["Customer Data Protection"],
        },
        created_at=now,
        updated_at=now,
        released_at=released_at,
        released_by=released_by,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_list_audit_empty(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/audit")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["events"] == []
    assert body["window"] == "24h"


def test_list_audit_quarantine_lifecycle(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy = _create_policy(db_session, name="Customer Data Protection", stream_id=stream_id)
    now = datetime.now(timezone.utc)
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        status=QUARANTINE_STATUS_RELEASED,
        policy_names=["Customer Data Protection"],
        created_at=now - timedelta(hours=2),
        released_at=now - timedelta(hours=1),
        released_by="operator@gdc",
    )

    resp = governance_client.get("/api/v1/governance/audit?window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 3
    correlation_ids = {row["correlation_id"] for row in body["events"]}
    assert f"q-{q_row.id}" in correlation_ids
    event_types = {row["event_type"] for row in body["events"] if row["correlation_id"] == f"q-{q_row.id}"}
    assert "VIOLATION_CREATED" in event_types
    assert "QUARANTINE_CREATED" in event_types
    assert "QUARANTINE_RELEASED" in event_types

    released = next(
        row for row in body["events"] if row["event_type"] == "QUARANTINE_RELEASED" and row["correlation_id"] == f"q-{q_row.id}"
    )
    assert released["policy_id"] == policy.id
    assert released["status"] == "RELEASED"


def test_list_audit_filter_event_type(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="Filter Policy", stream_id=stream_id)
    _create_quarantine(db_session, stream_id=stream_id, policy_names=["Filter Policy"])

    resp = governance_client.get("/api/v1/governance/audit?event_type=QUARANTINE_CREATED")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert all(row["event_type"] == "QUARANTINE_CREATED" for row in body["events"])


def test_list_audit_filter_policy(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy_a = _create_policy(db_session, name="Policy A", stream_id=stream_id)
    _create_policy(db_session, name="Policy B", stream_id=stream_id)
    _create_quarantine(db_session, stream_id=stream_id, policy_names=["Policy A"], reason="policy:Policy A")
    _create_quarantine(db_session, stream_id=stream_id, policy_names=["Policy B"], reason="policy:Policy B")

    resp = governance_client.get(f"/api/v1/governance/audit?policy_id={policy_a.id}")
    assert resp.status_code == 200
    assert all(row["policy_id"] == policy_a.id for row in resp.json()["events"])


def test_list_audit_policy_activated(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    policy = _create_policy(db_session, name="Activated Policy", stream_id=stream_id)

    resp = governance_client.get("/api/v1/governance/audit?event_type=POLICY_ACTIVATED&window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    row = body["events"][0]
    assert row["event_type"] == "POLICY_ACTIVATED"
    assert row["correlation_id"] == f"p-{policy.id}"
    assert row["status"] == "ACTIVE"


def test_audit_detail_full_timeline(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    now = datetime.now(timezone.utc)
    policy = _create_policy(
        db_session,
        name="Lifecycle Policy",
        stream_id=stream_id,
        activated_at=now - timedelta(hours=4),
    )
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        status=QUARANTINE_STATUS_RELEASED,
        policy_names=["Lifecycle Policy"],
        created_at=now - timedelta(hours=3),
        released_at=now - timedelta(hours=2),
        released_by="governance-operator",
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
            event_count=2,
            created_at=now - timedelta(hours=2),
            updated_at=now,
            last_replay_at=now - timedelta(minutes=30),
        )
    )
    db_session.commit()

    correlation_id = f"q-{q_row.id}"
    resp = governance_client.get(f"/api/v1/governance/audit/{correlation_id}?window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["correlation_id"] == correlation_id
    assert body["policy_id"] == policy.id
    assert body["policy_name"] == "Lifecycle Policy"
    assert body["stream_id"] == stream_id
    assert body["current_status"] == "DELIVERED"
    assert body["outcome"] == "DELIVERED"
    assert body["related_violation"]["violation_id"] == correlation_id
    assert body["related_quarantine"]["quarantine_event_id"] == q_row.id
    assert body["related_replay"] is not None

    timeline_types = [step["event_type"] for step in body["timeline"]]
    assert "POLICY_ACTIVATED" in timeline_types
    assert "VIOLATION_CREATED" in timeline_types
    assert "QUARANTINE_CREATED" in timeline_types
    assert "QUARANTINE_RELEASED" in timeline_types
    assert "REPLAY_STARTED" in timeline_types
    assert "REPLAY_COMPLETED" in timeline_types


def test_audit_detail_discarded_outcome(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="Discard Policy", stream_id=stream_id)
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        status=QUARANTINE_STATUS_DISCARDED,
        policy_names=["Discard Policy"],
    )

    resp = governance_client.get(f"/api/v1/governance/audit/q-{q_row.id}?window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["outcome"] == "DISCARDED"
    assert body["current_status"] == "DISCARDED"


def test_audit_detail_replay_failed(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    route_id = int(seeded["route_ids"][0])
    _create_policy(db_session, name="Fail Policy", stream_id=stream_id)
    now = datetime.now(timezone.utc)
    q_row = _create_quarantine(
        db_session,
        stream_id=stream_id,
        status=QUARANTINE_STATUS_RELEASED,
        policy_names=["Fail Policy"],
        created_at=now - timedelta(hours=2),
        released_at=now - timedelta(hours=1),
    )
    db_session.add(
        StreamReplayEvent(
            stream_id=stream_id,
            destination_id=destination_id,
            route_id=route_id,
            delivery_kind="base_route",
            status=REPLAY_STATUS_FAILED,
            protected_payload_json={"events": []},
            delivery_context_json={},
            event_count=1,
            created_at=now - timedelta(minutes=45),
            updated_at=now - timedelta(minutes=30),
            error_message="destination timeout",
        )
    )
    db_session.commit()

    resp = governance_client.get(f"/api/v1/governance/audit/q-{q_row.id}?window=24h")
    assert resp.status_code == 200
    body = resp.json()
    assert body["outcome"] == "FAILED"
    assert body["current_status"] == "FAILED"


def test_audit_detail_not_found(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/audit/q-999999")
    assert resp.status_code == 404


def test_audit_invalid_event_type(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/audit?event_type=UNKNOWN")
    assert resp.status_code == 400
