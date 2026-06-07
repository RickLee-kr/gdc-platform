"""M19.6 Governance Operations Center — summary, attention, activity feeds."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db_read_bounded
from app.governance_approval.models import (
    APPROVAL_EVENT_SUBMITTED,
    GovernancePolicyApprovalEvent,
)
from app.governance_policies.models import (
    POLICY_STATUS_ACTIVE,
    POLICY_STATUS_RETIRED,
    POLICY_STATUS_REVIEW,
    GovernancePolicy,
    StreamPolicyAssignment,
)
from app.quarantine.models import (
    QUARANTINE_SOURCE_POLICY,
    QUARANTINE_STATUS_QUARANTINED,
    StreamQuarantineEvent,
)
from app.replay.models import REPLAY_STATUS_FAILED, StreamReplayEvent
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
    from app.database import get_db

    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


def _create_policy(
    db_session: Session,
    *,
    name: str,
    status: str,
    stream_id: int | None = None,
) -> GovernancePolicy:
    now = datetime.now(timezone.utc)
    row = GovernancePolicy(
        name=name,
        description=None,
        category="DATA_PROTECTION",
        status=status,
        policy_json={
            "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
            "actions": [{"type": "quarantine"}],
        },
        version=1,
        activated_at=now if status == POLICY_STATUS_ACTIVE else None,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    if stream_id is not None:
        db_session.add(StreamPolicyAssignment(stream_id=int(stream_id), policy_id=row.id, enabled=True))
    db_session.commit()
    return row


def _create_quarantine(db_session: Session, *, stream_id: int) -> StreamQuarantineEvent:
    now = datetime.now(timezone.utc)
    row = StreamQuarantineEvent(
        stream_id=int(stream_id),
        quarantine_reason="policy:Test Policy",
        quarantine_source=QUARANTINE_SOURCE_POLICY,
        status=QUARANTINE_STATUS_QUARANTINED,
        protected_payload_json={"events": [{"classification": "RESTRICTED"}]},
        metadata_json={"event_count": 1, "policy_names": ["Test Policy"]},
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    return row


def _create_failed_replay(db_session: Session, *, stream_id: int, destination_id: int) -> StreamReplayEvent:
    now = datetime.now(timezone.utc)
    row = StreamReplayEvent(
        stream_id=int(stream_id),
        destination_id=int(destination_id),
        route_id=None,
        delivery_kind="base_route",
        status=REPLAY_STATUS_FAILED,
        protected_payload_json={"events": []},
        delivery_context_json={},
        error_type="delivery_error",
        error_message="destination unreachable",
        retry_count=1,
        event_count=1,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_operations_summary_empty(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/operations/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending_approvals"] == 0
    assert body["open_violations"] == 0
    assert body["quarantined_events"] == 0
    assert body["failed_replays"] == 0
    assert body["failed_notifications"] == 0
    assert body["pending_notifications"] == 0


def test_operations_attention_empty(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/operations/attention")
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_empty"] is True
    assert body["items"] == []


def test_operations_activity_empty(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/operations/activity")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["events"] == []


def test_operations_summary_pending_approvals(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    review_policy = _create_policy(db_session, name="Review Policy", status=POLICY_STATUS_REVIEW, stream_id=stream_id)
    now = datetime.now(timezone.utc)
    db_session.add(
        GovernancePolicyApprovalEvent(
            policy_id=int(review_policy.id),
            event_type=APPROVAL_EVENT_SUBMITTED,
            actor="Governance Operator",
            comment=None,
            created_at=now,
        )
    )
    db_session.commit()

    resp = governance_client.get("/api/v1/governance/operations/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending_approvals"] >= 1


def test_operations_summary_failed_replay_counts(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])
    _create_failed_replay(db_session, stream_id=stream_id, destination_id=destination_id)

    resp = governance_client.get("/api/v1/governance/operations/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["failed_replays"] == 1


def test_operations_attention_with_items(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    destination_id = int(seeded["destination_ids"][0])

    review_policy = _create_policy(db_session, name="Pending Policy", status=POLICY_STATUS_REVIEW, stream_id=stream_id)
    now = datetime.now(timezone.utc)
    db_session.add(
        GovernancePolicyApprovalEvent(
            policy_id=int(review_policy.id),
            event_type=APPROVAL_EVENT_SUBMITTED,
            actor="Governance Operator",
            comment="Please review",
            created_at=now,
        )
    )
    db_session.commit()

    _create_quarantine(db_session, stream_id=stream_id)
    _create_failed_replay(db_session, stream_id=stream_id, destination_id=destination_id)

    resp = governance_client.get("/api/v1/governance/operations/attention")
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_empty"] is False
    categories = {item["category"] for item in body["items"]}
    assert "pending_approvals" in categories
    assert "open_violations" in categories
    assert "failed_replays" in categories


def test_operations_activity_includes_events(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="Active Policy", status=POLICY_STATUS_ACTIVE, stream_id=stream_id)
    _create_quarantine(db_session, stream_id=stream_id)

    resp = governance_client.get("/api/v1/governance/operations/activity?limit=50")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert len(body["events"]) >= 1
    row = body["events"][0]
    assert "event_time" in row
    assert "event_type" in row
    assert "event_label" in row
    assert "status" in row
