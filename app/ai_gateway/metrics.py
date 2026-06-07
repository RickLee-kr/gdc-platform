"""AI Gateway delivery_logs observability."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.logs.models import DeliveryLog

AI_GATEWAY_EVALUATION_COMPLETE_STAGE = "ai_gateway_evaluation_complete"


def build_ai_gateway_evaluation_complete_payload(
    *,
    stream_id: int | None,
    classification_level: str,
    decision: str,
    matched_policy_count: int,
    processing_time_ms: int,
    provider: str | None = None,
    provider_called: bool | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "stage": AI_GATEWAY_EVALUATION_COMPLETE_STAGE,
        "message": "ai gateway evaluation complete",
        "classification_level": classification_level,
        "decision": decision,
        "matched_policy_count": max(0, int(matched_policy_count)),
        "processing_time_ms": max(0, int(processing_time_ms)),
        "latency_ms": max(0, int(processing_time_ms)),
    }
    if stream_id is not None:
        payload["stream_id"] = int(stream_id)
    if provider is not None:
        payload["provider"] = provider
    if provider_called is not None:
        payload["provider_called"] = bool(provider_called)
    return payload


def persist_ai_gateway_observability_log(
    db: Session,
    *,
    stream_id: int | None,
    classification_level: str,
    decision: str,
    matched_policy_count: int,
    processing_time_ms: int,
    provider: str | None = None,
    provider_called: bool | None = None,
) -> None:
    payload = build_ai_gateway_evaluation_complete_payload(
        stream_id=stream_id,
        classification_level=classification_level,
        decision=decision,
        matched_policy_count=matched_policy_count,
        processing_time_ms=processing_time_ms,
        provider=provider,
        provider_called=provider_called,
    )
    row = DeliveryLog(
        stream_id=stream_id,
        stage=AI_GATEWAY_EVALUATION_COMPLETE_STAGE,
        level="INFO",
        status="OK",
        message="ai gateway evaluation complete",
        payload_sample=payload,
        retry_count=0,
        latency_ms=max(0, int(processing_time_ms)),
    )
    db.add(row)
    db.flush()
