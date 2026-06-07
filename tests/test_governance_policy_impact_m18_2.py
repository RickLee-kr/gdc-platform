"""M18.2 Policy Impact Analysis — saved policy, draft preview, empty data, stream breakdown."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.classification.metrics import CLASSIFICATION_COMPLETE_STAGE
from app.database import get_db, get_db_read_bounded
from app.logs.models import DeliveryLog
from app.quarantine.metrics import QUARANTINE_EVENT_CREATED_STAGE
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
                payload_sample={"classification_level": level},
                created_at=now - timedelta(hours=1, minutes=idx),
            )
        )


def test_impact_for_existing_policy(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _seed_classification_logs(db_session, stream_id=stream_id, levels=["RESTRICTED", "RESTRICTED", "PUBLIC"])
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body())
    policy_id = create.json()["policy"]["id"]
    assign = governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={"assignments": [{"stream_id": stream_id, "enabled": True}]},
    )
    assert assign.status_code == 200

    impact = governance_policies_client.get(f"/api/v1/governance/policies/{policy_id}/impact")
    assert impact.status_code == 200
    body = impact.json()
    assert body["window"] == "24h"
    assert body["total_events"] == 3
    assert body["matched_events"] == 2
    assert body["actions"]["quarantine"] >= 2
    assert body["data_available"] is True
    assert len(body["streams"]) == 1
    assert body["streams"][0]["stream_id"] == stream_id
    assert body["streams"][0]["matched_events"] == 2


def test_impact_preview_for_draft_policy(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _seed_classification_logs(db_session, stream_id=stream_id, levels=["CONFIDENTIAL", "RESTRICTED", "RESTRICTED"])
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body())
    policy_id = create.json()["policy"]["id"]
    governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={"assignments": [{"stream_id": stream_id, "enabled": True}]},
    )

    preview = governance_policies_client.post(
        "/api/v1/governance/policies/impact-preview",
        json={
            "policy_id": policy_id,
            "policy_json": {
                "conditions": [{"field": "classification", "operator": "equals", "value": "CONFIDENTIAL"}],
                "actions": [{"type": "mask"}],
            },
            "stream_ids": [stream_id],
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["matched_events"] == 1
    assert body["delta"]["matched_events_change"] == -1


def test_impact_empty_runtime_data(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body())
    policy_id = create.json()["policy"]["id"]
    governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={"assignments": [{"stream_id": stream_id, "enabled": True}]},
    )

    impact = governance_policies_client.get(f"/api/v1/governance/policies/{policy_id}/impact")
    assert impact.status_code == 200
    body = impact.json()
    assert body["total_events"] == 0
    assert body["matched_events"] == 0
    assert body["data_available"] is False


def test_impact_stream_breakdown(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded_a = _seed_stream_runtime(db_session)
    stream_a = int(seeded_a["stream_id"])
    seeded_b = _seed_stream_runtime(db_session)
    stream_b = int(seeded_b["stream_id"])
    _seed_classification_logs(db_session, stream_id=stream_a, levels=["RESTRICTED"])
    _seed_classification_logs(db_session, stream_id=stream_b, levels=["PUBLIC", "PUBLIC"])
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body(name="Multi Stream"))
    policy_id = create.json()["policy"]["id"]
    governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={
            "assignments": [
                {"stream_id": stream_a, "enabled": True},
                {"stream_id": stream_b, "enabled": True},
            ]
        },
    )

    impact = governance_policies_client.get(f"/api/v1/governance/policies/{policy_id}/impact")
    assert impact.status_code == 200
    body = impact.json()
    assert body["total_events"] == 3
    assert body["matched_events"] == 1
    by_stream = {row["stream_id"]: row for row in body["streams"]}
    assert by_stream[stream_a]["matched_events"] == 1
    assert by_stream[stream_b]["matched_events"] == 0


def test_impact_preview_invalid_policy_json(governance_policies_client: TestClient) -> None:
    resp = governance_policies_client.post(
        "/api/v1/governance/policies/impact-preview",
        json={
            "policy_json": {
                "conditions": [{"field": "classification", "operator": "equals", "value": "RESTRICTED"}],
                "actions": [],
            }
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "GOVERNANCE_POLICY_VALIDATION"


def test_policy_list_includes_impact_summary(
    governance_policies_client: TestClient,
    db_session: Session,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _seed_classification_logs(db_session, stream_id=stream_id, levels=["RESTRICTED"])
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage=QUARANTINE_EVENT_CREATED_STAGE,
            level="INFO",
            status="OK",
            message="quarantine created",
            payload_sample={"quarantine_event_id": 1},
            created_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    db_session.commit()

    create = governance_policies_client.post("/api/v1/governance/policies", json=_sample_policy_body())
    policy_id = create.json()["policy"]["id"]
    governance_policies_client.put(
        f"/api/v1/governance/policies/{policy_id}/assignments",
        json={"assignments": [{"stream_id": stream_id, "enabled": True}]},
    )

    listed = governance_policies_client.get("/api/v1/governance/policies")
    assert listed.status_code == 200
    policy = next(p for p in listed.json()["policies"] if p["id"] == policy_id)
    assert policy["impact_data_available"] is True
    assert policy["impact_matched_events"] == 1
    assert policy["impact_summary"] == "1 matches / 24h"
