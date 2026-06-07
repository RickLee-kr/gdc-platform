"""M18.5 Governance Dashboard — policy-centric summary aggregates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db_read_bounded
from app.governance.cache import clear_governance_summary_cache
from app.governance.dashboard_service import build_policy_dashboard
from app.governance_policies.models import (
    POLICY_STATUS_ACTIVE,
    POLICY_STATUS_DRAFT,
    POLICY_STATUS_REVIEW,
    GovernancePolicy,
    StreamPolicyAssignment,
)
from app.classification.metrics import CLASSIFICATION_COMPLETE_STAGE
from app.logs.models import DeliveryLog
from app.quarantine.metrics import QUARANTINE_EVENT_CREATED_STAGE
from app.quarantine.models import QUARANTINE_SOURCE_POLICY, QUARANTINE_STATUS_QUARANTINED, StreamQuarantineEvent
from app.replay.metrics import REPLAY_EVENT_REPLAYED_STAGE
from app.replay.models import REPLAY_STATUS_REPLAYED, StreamReplayEvent
from tests.test_stream_runner_e2e import _seed_stream_runtime


def _governance_app() -> FastAPI:
    from app.governance.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/governance")
    return app


@pytest.fixture
def governance_client(db_session: Session) -> TestClient:
    clear_governance_summary_cache()
    app = _governance_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db_read_bounded] = _override_db
    client = TestClient(app)
    yield client
    clear_governance_summary_cache()


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
        db_session.add(
            StreamPolicyAssignment(
                stream_id=stream_id,
                policy_id=row.id,
                enabled=True,
            )
        )
    db_session.commit()
    return row


def test_dashboard_summary_empty_policies(governance_client: TestClient, db_session: Session) -> None:
    db_session.commit()
    resp = governance_client.get("/api/v1/governance/summary")
    assert resp.status_code == 200
    dashboard = resp.json()["policy_dashboard"]
    assert dashboard["has_policies"] is False
    assert dashboard["policy_kpi"] == {"active": 0, "review": 0, "draft": 0, "retired": 0}
    assert dashboard["dashboard_kpi"]["active_policies"] == 0
    assert dashboard["policy_catalog"] == []
    assert dashboard["top_policies_by_impact"] == []
    assert dashboard["policy_activity_timeline"] == []


def test_dashboard_policy_counts(governance_client: TestClient, db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="Customer Data Protection", status=POLICY_STATUS_ACTIVE, stream_id=stream_id)
    _create_policy(db_session, name="Employee PII Protection", status=POLICY_STATUS_REVIEW)
    _create_policy(db_session, name="Export Control", status=POLICY_STATUS_DRAFT)

    resp = governance_client.get("/api/v1/governance/summary")
    assert resp.status_code == 200
    kpi = resp.json()["policy_dashboard"]["policy_kpi"]
    assert kpi["active"] == 1
    assert kpi["review"] == 1
    assert kpi["draft"] == 1
    assert kpi["retired"] == 0

    dashboard_kpi = resp.json()["policy_dashboard"]["dashboard_kpi"]
    assert dashboard_kpi["active_policies"] == 1
    assert dashboard_kpi["policies_in_review"] == 1


def test_dashboard_quarantine_and_replay_summary(
    governance_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    now = datetime.now(timezone.utc)

    db_session.add(
        StreamQuarantineEvent(
            stream_id=stream_id,
            quarantine_reason="policy:test",
            quarantine_source=QUARANTINE_SOURCE_POLICY,
            status=QUARANTINE_STATUS_QUARANTINED,
            protected_payload_json={"events": [{"id": "q1"}]},
            metadata_json={"event_count": 1},
        )
    )
    db_session.add(
        StreamReplayEvent(
            stream_id=stream_id,
            destination_id=int(seeded["destination_ids"][0]),
            route_id=int(seeded["route_ids"][0]),
            delivery_kind="base_route",
            status=REPLAY_STATUS_REPLAYED,
            protected_payload_json={"events": [{"id": "r1"}]},
            delivery_context_json={"destination_type": "WEBHOOK_POST"},
        )
    )
    for stage, message in (
        (QUARANTINE_EVENT_CREATED_STAGE, "quarantine created"),
        (REPLAY_EVENT_REPLAYED_STAGE, "replay complete"),
    ):
        db_session.add(
            DeliveryLog(
                stream_id=stream_id,
                stage=stage,
                level="INFO",
                status="OK",
                message=message,
                payload_sample={"event_id": stage},
                created_at=now - timedelta(hours=1),
            )
        )
    db_session.commit()

    resp = governance_client.get("/api/v1/governance/summary")
    assert resp.status_code == 200
    body = resp.json()["policy_dashboard"]
    assert body["dashboard_kpi"]["quarantined_events"] >= 1
    assert body["quarantine_summary"]["h24"] >= 1
    assert body["replay_summary"]["h24"] >= 1


def test_dashboard_policy_catalog_and_impact_ranking(
    governance_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    now = datetime.now(timezone.utc)

    policy = _create_policy(
        db_session,
        name="Customer Data Protection",
        status=POLICY_STATUS_ACTIVE,
        stream_id=stream_id,
    )
    for _ in range(3):
        db_session.add(
            DeliveryLog(
                stream_id=stream_id,
                stage=CLASSIFICATION_COMPLETE_STAGE,
                level="INFO",
                status="OK",
                message="classification complete",
                payload_sample={"classification_level": "RESTRICTED"},
                created_at=now - timedelta(hours=1),
            )
        )
    db_session.commit()

    resp = governance_client.get("/api/v1/governance/summary")
    assert resp.status_code == 200
    dashboard = resp.json()["policy_dashboard"]
    assert dashboard["has_policies"] is True
    assert len(dashboard["policy_catalog"]) >= 1
    catalog_row = next(row for row in dashboard["policy_catalog"] if row["id"] == policy.id)
    assert catalog_row["name"] == "Customer Data Protection"
    assert catalog_row["status"] == POLICY_STATUS_ACTIVE
    assert catalog_row["assigned_stream_count"] == 1

    if dashboard["top_policies_by_impact"]:
        top = dashboard["top_policies_by_impact"][0]
        assert top["policy_name"] == "Customer Data Protection"
        assert top["matched_events"] >= 1


def test_build_policy_dashboard_direct(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="AI Data Sharing Policy", status=POLICY_STATUS_ACTIVE, stream_id=stream_id)

    dashboard = build_policy_dashboard(db_session, pending_quarantine_events=2, replayed_events_24h=5)
    assert dashboard.has_policies is True
    assert dashboard.dashboard_kpi.quarantined_events == 2
    assert dashboard.dashboard_kpi.replayed_events == 5
    assert dashboard.policy_kpi.active == 1
    assert len(dashboard.policy_activity_timeline) >= 1
