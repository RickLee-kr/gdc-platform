"""M20.3 Governance Dashboard vs Operations separation tests."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.role_guard import AuthContext
from app.database import get_db, get_db_read_bounded
from app.governance.dashboard_summary_service import get_governance_dashboard_summary
from app.governance_policies.models import GovernancePolicy
from app.quarantine.models import QUARANTINE_SOURCE_POLICY, QUARANTINE_STATUS_QUARANTINED, StreamQuarantineEvent
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
    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


def _create_policy(db_session: Session, *, name: str, status: str) -> GovernancePolicy:
    now = datetime.now(timezone.utc)
    row = GovernancePolicy(
        name=name,
        description=None,
        category="DATA_PROTECTION",
        status=status,
        policy_json={"conditions": [], "actions": []},
        version=1,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_dashboard_summary_api(governance_client: TestClient, db_session: Session) -> None:
    _create_policy(db_session, name="active-policy", status="ACTIVE")
    resp = governance_client.get("/api/v1/governance/dashboard/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_policies"] >= 1
    assert set(body["risk"].keys()) == {"critical", "high", "medium", "low"}
    assert "policy_health" in body
    assert "compliance_snapshot" in body
    assert isinstance(body["recent_activity"], list)


def test_dashboard_kpi_and_risk_aggregation(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(db_session, name="review-policy", status="REVIEW")
    now = datetime.now(timezone.utc)
    db_session.add(
        StreamQuarantineEvent(
            stream_id=stream_id,
            quarantine_reason="policy match",
            quarantine_source=QUARANTINE_SOURCE_POLICY,
            status=QUARANTINE_STATUS_QUARANTINED,
            protected_payload_json={"events": [{"message": "x"}]},
            metadata_json={},
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    summary = get_governance_dashboard_summary(db_session)
    assert summary.open_violations >= 1
    assert summary.quarantined_events >= 1
    assert summary.compliance_snapshot.quarantines_24h >= 1


def test_operations_queue_aggregation(governance_client: TestClient, db_session: Session) -> None:
    _create_policy(db_session, name="pending-policy", status="REVIEW")
    resp = governance_client.get("/api/v1/governance/operations/queue")
    assert resp.status_code == 200
    body = resp.json()
    for key in ("action_required", "pending_approvals", "violations", "quarantine", "replays", "notifications"):
        assert key in body


def test_operations_summary_queue_counts(governance_client: TestClient) -> None:
    resp = governance_client.get("/api/v1/governance/operations/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "pending_approvals" in body
    assert "failed_notifications" in body
    assert "active_policies" not in body


def test_dashboard_page_has_no_action_buttons() -> None:
    text = Path("frontend/src/components/governance/governance-dashboard-page.tsx").read_text(encoding="utf-8")
    assert 'label="Approve"' not in text
    assert 'label="Reject"' not in text
    assert 'label="Release"' not in text
    assert 'label="Execute"' not in text


def test_operations_rbac_blocks_viewer(monkeypatch: pytest.MonkeyPatch, governance_client: TestClient) -> None:
    from app.auth import governance_rbac

    monkeypatch.setattr(
        governance_rbac,
        "_resolve",
        lambda request: AuthContext(username="viewer", role="VIEWER", token_version=1, source="test"),
    )

    assert governance_client.get("/api/v1/governance/dashboard/summary").status_code == 200
    assert governance_client.get("/api/v1/governance/operations/summary").status_code == 403
