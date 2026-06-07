"""M14.1 AI Gateway Hardening — policy CRUD, prompt inspection, quarantine, provider guard."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai_gateway.metrics import AI_GATEWAY_EVALUATION_COMPLETE_STAGE
from app.ai_gateway.models import (
    GATEWAY_ACTION_AUDIT,
    GATEWAY_ACTION_BLOCK,
    GATEWAY_ACTION_QUARANTINE,
    AiGatewayPolicy,
    AiGatewayRequest,
)
from app.ai_gateway.provider import invoke_mock_provider
from app.protection.models import PROTECTION_MODE_FULL_MASK, StreamProtectionRule
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


def test_policy_crud_api(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    create = ai_gateway_client.post(
        "/api/v1/ai-gateway/policies",
        json={
            "name": "Audit PII",
            "enabled": True,
            "condition_json": {"sensitivity_class": "pii"},
            "action_type": "audit",
        },
    )
    assert create.status_code == 201
    policy = create.json()["policy"]
    assert policy["name"] == "Audit PII"
    assert policy["condition_summary"] == "sensitivity_class=pii"
    policy_id = policy["id"]

    listed = ai_gateway_client.get("/api/v1/ai-gateway/policies")
    assert listed.status_code == 200
    assert any(p["id"] == policy_id for p in listed.json()["policies"])

    patched = ai_gateway_client.patch(
        f"/api/v1/ai-gateway/policies/{policy_id}",
        json={"enabled": False, "action_type": "block"},
    )
    assert patched.status_code == 200
    assert patched.json()["policy"]["enabled"] is False
    assert patched.json()["policy"]["action_type"] == "block"


def test_prompt_body_email_pii_detection(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    _create_policy(
        db_session,
        name="Audit pii prompt",
        condition_json={"sensitivity_class": "pii"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "user@example.com", "metadata": {}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["decision"] == "audit"
    assert "pii" in body["sensitivity_classes"]


def test_prompt_body_api_key_secret_detection(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    _create_policy(
        db_session,
        name="Block secret prompt",
        condition_json={"sensitivity_class": "secret"},
        action_type=GATEWAY_ACTION_BLOCK,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "sk-live-abcdef1234567890", "metadata": {}},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["decision"] == "block"


def test_metadata_detection_preserved(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Audit metadata pii",
        condition_json={"sensitivity_class": "pii"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={
            "prompt": "summarize account",
            "metadata": {"stream_id": stream_id, "email": "user@example.com"},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["decision"] == "audit"


def test_allow_without_stream_id(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    db_session.commit()
    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "hello platform", "metadata": {}},
    )
    assert resp.status_code == 200
    assert resp.json()["decision"] == "allow"


def test_block_without_stream_id(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    _create_policy(
        db_session,
        name="Block secret no stream",
        condition_json={"sensitivity_class": "secret"},
        action_type=GATEWAY_ACTION_BLOCK,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "sk-live-abcdef1234567890", "metadata": {}},
    )
    assert resp.status_code == 403


def test_quarantine_without_stream_id_returns_400(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    _create_policy(
        db_session,
        name="Quarantine secret no stream",
        condition_json={"sensitivity_class": "secret"},
        action_type=GATEWAY_ACTION_QUARANTINE,
    )
    db_session.commit()

    resp = ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "sk-live-abcdef1234567890", "metadata": {}},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["error_code"] == "AI_GATEWAY_STREAM_ID_REQUIRED_FOR_QUARANTINE"


def test_quarantine_payload_structure(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    raw_token = "supersecretvalue12345"
    db_session.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.metadata.token",
            sensitivity_class="secret",
            protection_mode=PROTECTION_MODE_FULL_MASK,
            enabled=True,
            created_by="test",
        )
    )
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
            "metadata": {"stream_id": stream_id, "token": raw_token},
        },
    )
    assert resp.status_code == 200
    qid = resp.json()["quarantine_event_id"]
    assert qid is not None

    row = db_session.get(StreamQuarantineEvent, qid)
    assert row is not None
    payload = row.protected_payload_json
    assert isinstance(payload, dict)
    events = payload.get("events")
    assert isinstance(events, list) and len(events) == 1
    event = events[0]
    assert event.get("prompt_text") == "summarize credentials file"
    assert isinstance(event.get("metadata"), dict)
    assert "classification_level" in event
    assert raw_token not in str(event)
    assert "provider" not in payload
    assert "completion" not in str(payload)


def test_block_decision_provider_not_called(
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

    call_count = {"n": 0}
    original = invoke_mock_provider

    def _counting(*args: Any, **kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        return original(*args, **kwargs)

    with patch("app.ai_gateway.service.invoke_mock_provider", side_effect=_counting):
        resp = ai_gateway_client.post(
            "/api/v1/ai-gateway/chat",
            json={
                "prompt": "status",
                "metadata": {"stream_id": stream_id, "api_key": "sk-live-abcdef1234567890"},
            },
        )
    assert resp.status_code == 403
    assert call_count["n"] == 0


def test_quarantine_decision_provider_not_called(
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

    call_count = {"n": 0}
    original = invoke_mock_provider

    def _counting(*args: Any, **kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        return original(*args, **kwargs)

    with patch("app.ai_gateway.service.invoke_mock_provider", side_effect=_counting):
        resp = ai_gateway_client.post(
            "/api/v1/ai-gateway/chat",
            json={
                "prompt": "credentials",
                "metadata": {"stream_id": stream_id, "token": "supersecretvalue12345"},
            },
        )
    assert resp.status_code == 200
    assert resp.json()["decision"] == "quarantine"
    assert call_count["n"] == 0


def test_allow_audit_provider_called_on_chat(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Audit internal",
        condition_json={"classification_level": "INTERNAL"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    call_count = {"n": 0}
    original = invoke_mock_provider

    def _counting(*args: Any, **kwargs: Any) -> dict[str, Any]:
        call_count["n"] += 1
        return original(*args, **kwargs)

    with patch("app.ai_gateway.service.invoke_mock_provider", side_effect=_counting):
        resp = ai_gateway_client.post(
            "/api/v1/ai-gateway/chat",
            json={"prompt": "hello", "metadata": {"stream_id": stream_id}},
        )
    assert resp.status_code == 200
    assert call_count["n"] == 1


def test_summary_bounded_query(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    for i in range(3):
        ai_gateway_client.post(
            "/api/v1/ai-gateway/evaluate",
            json={"prompt": f"req-{i}", "metadata": {"stream_id": stream_id}},
        )

    with patch.object(db_session, "query") as mock_query:
        summary = ai_gateway_client.get("/api/v1/ai-gateway/summary")
        assert mock_query.call_count == 0

    assert summary.status_code == 200
    data = summary.json()
    assert len(data["recent_requests"]) <= 20
    assert data["allow_count"] >= 3


def test_observability_payload_includes_provider_fields(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    _create_policy(
        db_session,
        name="Audit internal obs",
        condition_json={"classification_level": "INTERNAL"},
        action_type=GATEWAY_ACTION_AUDIT,
    )
    db_session.commit()

    ai_gateway_client.post(
        "/api/v1/ai-gateway/chat",
        json={"prompt": "observe", "metadata": {"stream_id": stream_id, "provider": "mock"}},
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
    assert sample["decision"] == "audit"
    assert "matched_policy_count" in sample
    assert "processing_time_ms" in sample
    assert sample.get("provider") == "mock"
    assert sample.get("provider_called") is True


def test_summary_uses_ai_gateway_requests_not_delivery_logs(
    ai_gateway_client: TestClient,
    db_session: Session,
    gateway_settings: None,
) -> None:
    seeded = _seed_stream_runtime(db_session)
    stream_id = int(seeded["stream_id"])
    db_session.commit()

    ai_gateway_client.post(
        "/api/v1/ai-gateway/evaluate",
        json={"prompt": "count me", "metadata": {"stream_id": stream_id}},
    )

    req_count = db_session.query(AiGatewayRequest).count()
    assert req_count >= 1
    summary = ai_gateway_client.get("/api/v1/ai-gateway/summary").json()
    assert summary["allow_count"] >= 1
