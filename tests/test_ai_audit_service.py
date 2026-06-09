"""Unit tests for AI audit service (M23)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.ai_audit.models import (
    AI_AUDIT_EVENT_PROMPT_BLOCKED,
    AI_AUDIT_EVENT_RESPONSE_MASKED,
    AiAuditEvent,
)
from app.ai_audit.service import (
    AiAuditContext,
    build_ai_audit_metrics,
    correlate_ai_audit_request,
    list_ai_audit_events,
    record_inspection_audit,
)
from app.ai_policy.inspection import AiInspectionResult
from app.ai_policy.models import (
    AI_POLICY_ACTION_ALLOW,
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_TARGET_PROMPT,
    AI_POLICY_TARGET_RESPONSE,
)
from app.protection.policy_engine import AiPolicyBatchResult, AiPolicyMatch
from tests.ai_policy_test_helpers import seed_ai_stream_for_policy


def _inspection(*, target: str, decision: str, rule_id: int = 1, rule_name: str = "test-rule") -> AiInspectionResult:
    return AiInspectionResult(
        target=target,
        text="sample text",
        finding_count=1,
        policy=AiPolicyBatchResult(
            decision=decision,
            matched_policies=[
                AiPolicyMatch(
                    policy_id=rule_id,
                    policy_name=rule_name,
                    action_type=decision,
                    inspection_type="keyword",
                )
            ],
            matched_policy_count=1,
        ),
        findings=[{"pattern": "secret", "matched_rule": "pattern.secret"}],
    )


def test_record_inspection_audit_persists_evidence(db_session: Session) -> None:
    from app.ai_policy.models import (
        AI_POLICY_INSPECTION_KEYWORD,
        AI_POLICY_TARGET_PROMPT,
    )
    from app.ai_policy.service import create_ai_policy_rule

    stack = seed_ai_stream_for_policy(db_session, slug="audit-unit")
    rule = create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="test-rule",
        enabled=True,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "secret"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    ctx = AiAuditContext(
        request_id="req-audit-1",
        stream_id=stack["stream_id"],
        ai_stream_id=stack["ai_stream_id"],
        ai_provider_id=stack["provider_id"],
        provider="MOCK",
        model="mock-model",
    )
    row = record_inspection_audit(
        db_session,
        _inspection(target=AI_POLICY_TARGET_PROMPT, decision=AI_POLICY_ACTION_BLOCK, rule_id=int(rule.id)),
        ctx=ctx,
    )
    assert row is not None
    db_session.commit()

    assert row.event_type == AI_AUDIT_EVENT_PROMPT_BLOCKED
    assert row.action == AI_POLICY_ACTION_BLOCK
    assert row.matched_rule == "test-rule"
    assert row.matched_pattern == "secret"
    assert row.provider == "MOCK"
    assert row.model == "mock-model"
    assert row.request_id == "req-audit-1"


def test_build_ai_audit_metrics_aggregates_by_provider_and_stream(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="audit-metrics")
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            AiAuditEvent(
                stream_id=stack["stream_id"],
                ai_provider_id=stack["provider_id"],
                ai_stream_id=stack["ai_stream_id"],
                request_id="req-1",
                event_type=AI_AUDIT_EVENT_PROMPT_BLOCKED,
                policy_rule_id=None,
                action="block",
                created_at=now,
            ),
            AiAuditEvent(
                stream_id=stack["stream_id"],
                ai_provider_id=stack["provider_id"],
                ai_stream_id=stack["ai_stream_id"],
                request_id="req-2",
                event_type=AI_AUDIT_EVENT_RESPONSE_MASKED,
                policy_rule_id=None,
                action="mask",
                created_at=now,
            ),
        ]
    )
    db_session.commit()

    metrics = build_ai_audit_metrics(db_session, hours=24)
    assert metrics["totals"]["blocked_count"] == 1
    assert metrics["totals"]["masked_count"] == 1
    assert metrics["totals"]["response_mask_count"] == 1
    assert metrics["by_provider"][0]["provider_id"] == stack["provider_id"]
    assert metrics["by_stream"][0]["stream_id"] == stack["stream_id"]


def test_list_and_correlate_audit_events(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="audit-corr")
    now = datetime.now(timezone.utc)
    from app.ai_policy.models import (
        AI_POLICY_ACTION_BLOCK,
        AI_POLICY_INSPECTION_KEYWORD,
        AI_POLICY_TARGET_PROMPT,
    )
    from app.ai_policy.service import create_ai_policy_rule

    rule = create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="corr-rule",
        enabled=True,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "x"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.add(
        AiAuditEvent(
            stream_id=stack["stream_id"],
            ai_provider_id=stack["provider_id"],
            ai_stream_id=stack["ai_stream_id"],
            request_id="corr-req",
            event_type=AI_AUDIT_EVENT_PROMPT_BLOCKED,
            policy_rule_id=int(rule.id),
            action="block",
            provider="MOCK",
            model="mock-model",
            created_at=now,
        )
    )
    db_session.commit()

    rows = list_ai_audit_events(db_session, request_id="corr-req")
    assert len(rows) == 1
    payload = correlate_ai_audit_request(db_session, "corr-req")
    assert payload["request_id"] == "corr-req"
    assert payload["policy_rule_ids"] == [int(rule.id)]
    assert payload["provider"] == "MOCK"


def test_record_inspection_audit_skips_without_request_id(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="audit-skip")
    ctx = AiAuditContext(request_id="", stream_id=stack["stream_id"])
    row = record_inspection_audit(
        db_session,
        _inspection(target=AI_POLICY_TARGET_RESPONSE, decision=AI_POLICY_ACTION_ALLOW),
        ctx=ctx,
    )
    assert row is None
