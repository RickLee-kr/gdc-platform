"""M14 AI Gateway MVP — policy enforcement, provider mock, summary, observability."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai_gateway.models import (
    GATEWAY_ACTION_AUDIT,
    GATEWAY_ACTION_BLOCK,
    GATEWAY_ACTION_QUARANTINE,
    AiGatewayPolicy,
)
from app.ai_gateway.provider import invoke_mock_provider
from app.ai_gateway.metrics import AI_GATEWAY_EVALUATION_COMPLETE_STAGE
from app.database import get_db, get_db_read_bounded
from app.logs.models import DeliveryLog
from app.quarantine.models import StreamQuarantineEvent
from tests.test_stream_runner_e2e import _seed_stream_runtime


def _ai_gateway_app() -> FastAPI:
    from app.ai_gateway.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/ai-gateway")
    return app


@pytest.fixture
def ai_gateway_client(db_session: Session) -> TestClient:
    app = _ai_gateway_app()

    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    return TestClient(app)


@pytest.fixture
def gateway_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_CLASSIFICATION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_SENSITIVE_DETECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)


def _create_policy(
    db: Session,
    *,
    name: str,
    condition_json: dict[str, Any],
    action_type: str,
    enabled: bool = True,
) -> AiGatewayPolicy:
    row = AiGatewayPolicy(
        name=name,
        enabled=enabled,
        condition_json=condition_json,
        action_type=action_type,
    )
    db.add(row)
    db.flush()
    return row


def test_allow_decision_no_provider_on_evaluate(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "hello world", "metadata": {"stream_id": stream_id}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["decision"] == "allow"
    assert body["provider_called"] is False
    assert body["provider_response"] is None


def test_audit_decision_calls_provider_on_chat(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Audit all internal",
        condition_json={"classification_level": "INTERNAL"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/chat",
        json={"prompt": "status update", "metadata": {"stream_id": stream_id, "provider": "mock"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["decision"] == "audit"
    assert body["provider_called"] is True
    assert body["provider_response"]["provider"] == "mock"


def test_block_decision_403_no_provider(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Block restricted",
        condition_json={"classification_level": "RESTRICTED"},
        action_type=GATEWAY_ACTION_BLOCK,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/chat",
        json={
            "prompt": "summarize deployment status",
            "metadata": {"stream_id": stream_id, "api_key": "sk-live-abcdef1234567890"},
        },
    )
    assert resp.status_code == 403
    detail = resp.json()["detail"]
    assert detail["decision"] == "block"

    mock = invoke_mock_provider(prompt="should not run")
    assert "mock" in mock["completion"]


def test_quarantine_no_provider_stores_event(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Quarantine secret",
        condition_json={"sensitivity_class": "secret"},
        action_type=GATEWAY_ACTION_QUARANTINE,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/chat",
        json={
            "prompt": "summarize credentials file",
            "metadata": {"stream_id": stream_id, "token": "supersecretvalue12345"},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["decision"] == "quarantine"
    assert body["provider_called"] is False
    assert body["quarantine_event_id"] is not None

    row = db_session.get(StreamQuarantineEvent, body["quarantine_event_id"])
    assert row is not None
    assert row.stream_id == stream_id


def test_classification_based_policy(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Block confidential",
        condition_json={"classification_level": "CONFIDENTIAL"},
        action_type=GATEWAY_ACTION_BLOCK,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={
            "prompt": "contact billing team",
            "metadata": {"stream_id": stream_id, "email": "user@corp.example"},
        },
    )
    assert resp.status_code == 403


def test_sensitivity_based_policy(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Audit pii",
        condition_json={"sensitivity_class": "pii"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/chat",
        json={
            "prompt": "please summarize account activity",
            "metadata": {"stream_id": stream_id, "email": "user@example.com"},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["decision"] == "audit"


def test_summary_counts(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Allow internal",
        condition_json={"classification_level": "INTERNAL"},
        action_type="allow",
    )
    db_session.commit()

    ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "plain", "metadata": {"stream_id": stream_id}},
    )

    summary = ai_gateway_client.get("/api/v1/ai-gateway/summary")
    assert summary.status_code == 200
    data = summary.json()
    assert data["allow_count"] >= 1
    assert isinstance(data["recent_requests"], list)
    assert isinstance(data["policies"], list)


def test_observability_delivery_log(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    db_session.commit()

    ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "observe me", "metadata": {"stream_id": stream_id}},
    )

    row = (
        db_session.query(DeliveryLog)
        .filter(
            DeliveryLog.stream_id == stream_id,
            DeliveryLog.stage == AI_GATEWAY_EVALUATION_COMPLETE_STAGE,
        )
        .order_by(DeliveryLog.id.desc())
        .first()
    )
    assert row is not None
    sample = row.payload_sample
    assert sample["classification_level"]
    assert sample["decision"] == "allow"
    assert "matched_policy_count" in sample
    assert "processing_time_ms" in sample
