"""AI Gateway evaluate/chat/summary orchestration."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai_gateway.inspection import PromptInspectionResult, inspect_prompt
from app.ai_gateway.metrics import persist_ai_gateway_observability_log
from app.ai_gateway.models import (
    GATEWAY_ACTION_ALLOW,
    GATEWAY_ACTION_AUDIT,
    GATEWAY_ACTION_BLOCK,
    GATEWAY_ACTION_QUARANTINE,
    AiGatewayPolicy,
    AiGatewayRequest,
)
from app.ai_gateway.policy_engine import GatewayPolicyBatchResult
from app.ai_gateway.policy_service import format_condition_summary
from app.ai_gateway.provider import invoke_mock_provider
from app.ai_gateway.quarantine_integration import record_ai_gateway_quarantine_event
from app.ai_gateway.schemas import (
    AiGatewayChatResponse,
    AiGatewayEvaluateResponse,
    AiGatewayPolicyEntry,
    AiGatewayRequestEntry,
    AiGatewaySummaryResponse,
)
from app.streams.repository import get_stream_by_id


class AiGatewayBlockedError(Exception):
    def __init__(self, *, request_id: str, inspection: PromptInspectionResult) -> None:
        self.request_id = request_id
        self.inspection = inspection
        super().__init__("ai gateway blocked request")


def _normalize_metadata(raw: Any) -> dict[str, Any]:
    if hasattr(raw, "model_dump"):
        return raw.model_dump()
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def policy_entry_for_row(row: AiGatewayPolicy) -> AiGatewayPolicyEntry:
    condition = row.condition_json if isinstance(row.condition_json, dict) else {}
    return AiGatewayPolicyEntry(
        id=int(row.id),
        name=str(row.name),
        enabled=bool(row.enabled),
        condition_json=condition,
        action_type=str(row.action_type),
        condition_summary=format_condition_summary(condition),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _policy_entries(db: Session) -> list[AiGatewayPolicyEntry]:
    rows = list(db.execute(select(AiGatewayPolicy).order_by(AiGatewayPolicy.id)).scalars())
    return [policy_entry_for_row(row) for row in rows]


def _persist_audit_row(
    db: Session,
    *,
    request_id: str,
    stream_id: int | None,
    classification_level: str,
    decision: str,
    provider: str,
    processing_time_ms: int,
    matched_policy_count: int,
) -> None:
    row = AiGatewayRequest(
        request_id=request_id,
        stream_id=stream_id,
        classification_level=classification_level,
        decision=decision,
        provider=provider,
        processing_time_ms=max(0, int(processing_time_ms)),
        matched_policy_count=max(0, int(matched_policy_count)),
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)


def _finalize_observability(
    db: Session,
    *,
    stream_id: int | None,
    inspection: PromptInspectionResult,
    gateway: GatewayPolicyBatchResult,
    provider: str,
    provider_called: bool,
) -> None:
    persist_ai_gateway_observability_log(
        db,
        stream_id=stream_id,
        classification_level=inspection.classification_level,
        decision=gateway.decision,
        matched_policy_count=gateway.matched_policy_count,
        processing_time_ms=inspection.processing_time_ms,
        provider=provider,
        provider_called=provider_called,
    )


def evaluate_prompt(
    db: Session,
    *,
    prompt: str,
    metadata: Any,
    invoke_provider: bool,
) -> AiGatewayEvaluateResponse | AiGatewayChatResponse:
    meta = _normalize_metadata(metadata)
    stream_id_raw = meta.get("stream_id")
    stream_id = int(stream_id_raw) if stream_id_raw is not None else None
    provider = str(meta.get("provider") or "mock").strip() or "mock"

    if stream_id is not None and get_stream_by_id(db, stream_id) is None:
        raise HTTPException(status_code=404, detail="stream not found")

    request_id = str(uuid.uuid4())
    inspection = inspect_prompt(db, prompt=prompt, metadata=meta)
    gateway = inspection.gateway_policy
    decision = str(gateway.decision)

    quarantine_event_id: int | None = None
    provider_called = False
    provider_response: dict[str, Any] | None = None

    if decision == GATEWAY_ACTION_BLOCK:
        _persist_audit_row(
            db,
            request_id=request_id,
            stream_id=stream_id,
            classification_level=inspection.classification_level,
            decision=decision,
            provider=provider,
            processing_time_ms=inspection.processing_time_ms,
            matched_policy_count=gateway.matched_policy_count,
        )
        _finalize_observability(
            db,
            stream_id=stream_id,
            inspection=inspection,
            gateway=gateway,
            provider=provider,
            provider_called=False,
        )
        db.commit()
        raise AiGatewayBlockedError(request_id=request_id, inspection=inspection)

    if decision == GATEWAY_ACTION_QUARANTINE:
        if stream_id is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "AI_GATEWAY_STREAM_ID_REQUIRED_FOR_QUARANTINE",
                    "message": "metadata.stream_id is required for quarantine decisions",
                },
            )
        row = record_ai_gateway_quarantine_event(
            db,
            stream_id=stream_id,
            prompt_text=inspection.prompt_text,
            metadata=inspection.metadata,
            classification_level=inspection.classification_level,
            protected_events=inspection.protected_events,
            matched_policies=gateway.matched_policies,
            request_id=request_id,
        )
        if row is not None:
            quarantine_event_id = int(row.id)

    elif invoke_provider and decision in (GATEWAY_ACTION_ALLOW, GATEWAY_ACTION_AUDIT):
        provider_response = invoke_mock_provider(prompt=prompt, metadata=meta, provider=provider)
        provider_called = True

    _persist_audit_row(
        db,
        request_id=request_id,
        stream_id=stream_id,
        classification_level=inspection.classification_level,
        decision=decision,
        provider=provider,
        processing_time_ms=inspection.processing_time_ms,
        matched_policy_count=gateway.matched_policy_count,
    )
    _finalize_observability(
        db,
        stream_id=stream_id,
        inspection=inspection,
        gateway=gateway,
        provider=provider,
        provider_called=provider_called,
    )
    db.commit()

    return AiGatewayEvaluateResponse(
        request_id=request_id,
        classification_level=inspection.classification_level,
        decision=decision,
        matched_policy_count=gateway.matched_policy_count,
        sensitivity_classes=inspection.sensitivity_classes,
        finding_count=inspection.finding_count,
        protection_applied=inspection.protection_applied,
        processing_time_ms=inspection.processing_time_ms,
        provider_called=provider_called,
        provider_response=provider_response,
        quarantine_event_id=quarantine_event_id,
    )


_SUMMARY_WINDOW_HOURS = 24


def build_gateway_summary(db: Session, *, recent_limit: int = 20) -> AiGatewaySummaryResponse:
    until = datetime.now(timezone.utc)
    since = until - timedelta(hours=_SUMMARY_WINDOW_HOURS)
    window_filter = (
        AiGatewayRequest.created_at >= since,
        AiGatewayRequest.created_at < until,
    )
    counts = dict(
        db.execute(
            select(AiGatewayRequest.decision, func.count(AiGatewayRequest.id))
            .where(*window_filter)
            .group_by(AiGatewayRequest.decision)
        ).all()
    )
    avg_row = db.execute(
        select(func.avg(AiGatewayRequest.processing_time_ms)).where(*window_filter)
    ).scalar()
    lim = max(1, min(int(recent_limit), 100))
    recent_rows = list(
        db.execute(
            select(AiGatewayRequest)
            .order_by(AiGatewayRequest.created_at.desc(), AiGatewayRequest.id.desc())
            .limit(lim)
        ).scalars()
    )
    recent = [
        AiGatewayRequestEntry(
            request_id=str(row.request_id),
            stream_id=row.stream_id,
            classification_level=str(row.classification_level),
            decision=str(row.decision),
            provider=str(row.provider),
            processing_time_ms=int(row.processing_time_ms or 0),
            matched_policy_count=int(row.matched_policy_count or 0),
            created_at=row.created_at,
        )
        for row in recent_rows
    ]
    return AiGatewaySummaryResponse(
        allow_count=int(counts.get("allow") or 0),
        audit_count=int(counts.get("audit") or 0),
        block_count=int(counts.get("block") or 0),
        quarantine_count=int(counts.get("quarantine") or 0),
        avg_processing_time_ms=float(avg_row or 0.0),
        recent_requests=recent,
        policies=_policy_entries(db),
    )
