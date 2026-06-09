"""Unit tests for AI governance service (M24)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.ai_governance.models import (
    VIOLATION_STATUS_ACKNOWLEDGED,
    VIOLATION_STATUS_OPEN,
    VIOLATION_STATUS_RESOLVED,
    AiPolicyViolation,
)
from app.ai_governance.service import (
    AiPolicyViolationStateError,
    acknowledge_ai_policy_violation,
    build_ai_governance_dashboard,
    build_policy_impact_analysis,
    record_policy_violation,
    resolve_ai_policy_violation,
)
from app.ai_policy.inspection import AiInspectionResult
from app.protection.policy_engine import AiPolicyBatchResult, AiPolicyMatch
from tests.ai_policy_test_helpers import seed_ai_stream_for_policy


def _inspection(*, action: str, policy_id: int = 1, policy_name: str = "test-rule") -> AiInspectionResult:
    return AiInspectionResult(
        target="prompt",
        text="sample",
        findings=[],
        policy=AiPolicyBatchResult(
            decision=action,
            matched_policies=[
                AiPolicyMatch(
                    policy_id=policy_id,
                    policy_name=policy_name,
                    action_type=action,
                    inspection_type="keyword",
                )
            ],
        ),
    )


def _seed_violation(db: Session, *, request_id: str = "gov-req-1", action: str = "block") -> AiPolicyViolation:
    stack = seed_ai_stream_for_policy(db, slug=f"gov-{request_id}")
    row = AiPolicyViolation(
        request_id=request_id,
        stream_id=stack["stream_id"],
        ai_provider_id=stack["provider_id"],
        ai_stream_id=stack["ai_stream_id"],
        policy_rule_id=None,
        provider="MOCK",
        ai_stream=stack["slug"],
        rule_id="block-keyword",
        action=action,
        severity="HIGH",
        status=VIOLATION_STATUS_OPEN,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_record_policy_violation_skips_allow(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="gov-allow")
    row = record_policy_violation(
        db_session,
        _inspection(action="allow"),
        request_id="allow-req",
        stream_id=stack["stream_id"],
        ai_stream_id=stack["ai_stream_id"],
        provider="MOCK",
    )
    assert row is None


def test_record_policy_violation_persists_block(db_session: Session) -> None:
    from app.ai_policy.models import (
        AI_POLICY_ACTION_BLOCK,
        AI_POLICY_INSPECTION_KEYWORD,
        AI_POLICY_TARGET_PROMPT,
    )
    from app.ai_policy.service import create_ai_policy_rule

    stack = seed_ai_stream_for_policy(db_session, slug="gov-block")
    rule = create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="block-keyword",
        enabled=True,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "secret"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.flush()
    row = record_policy_violation(
        db_session,
        _inspection(action="block", policy_id=int(rule.id), policy_name="block-keyword"),
        request_id="block-req",
        stream_id=stack["stream_id"],
        ai_stream_id=stack["ai_stream_id"],
        ai_provider_id=stack["provider_id"],
        provider="MOCK",
    )
    assert row is not None
    db_session.commit()
    assert row.action == "block"
    assert row.rule_id == "block-keyword"
    assert row.status == VIOLATION_STATUS_OPEN


def test_acknowledge_and_resolve_workflow(db_session: Session) -> None:
    row = _seed_violation(db_session, request_id="gov-workflow")
    ack = acknowledge_ai_policy_violation(
        db_session,
        violation_id=int(row.id),
        actor_username="operator",
        note="reviewed",
    )
    assert ack.status == VIOLATION_STATUS_ACKNOWLEDGED
    assert ack.acknowledged_by == "operator"
    resolved = resolve_ai_policy_violation(
        db_session,
        violation_id=int(row.id),
        actor_username="operator",
        note="fixed",
    )
    assert resolved.status == VIOLATION_STATUS_RESOLVED
    assert resolved.resolved_by == "operator"


def test_acknowledge_rejects_non_open(db_session: Session) -> None:
    row = _seed_violation(db_session, request_id="gov-ack-err")
    row.status = VIOLATION_STATUS_RESOLVED
    db_session.commit()
    with pytest.raises(AiPolicyViolationStateError):
        acknowledge_ai_policy_violation(
            db_session,
            violation_id=int(row.id),
            actor_username="operator",
        )


def test_policy_impact_analysis_groups_actions(db_session: Session) -> None:
    _seed_violation(db_session, request_id="gov-impact-block", action="block")
    _seed_violation(db_session, request_id="gov-impact-mask", action="mask")
    _seed_violation(db_session, request_id="gov-impact-redact", action="redact")
    rows = build_policy_impact_analysis(db_session, hours=24)
    assert rows
    total_blocks = sum(r["block_count"] for r in rows)
    total_masks = sum(r["mask_count"] for r in rows)
    total_redacts = sum(r["redact_count"] for r in rows)
    assert total_blocks >= 1
    assert total_masks >= 1
    assert total_redacts >= 1


def test_dashboard_summary_counts_violations(db_session: Session) -> None:
    _seed_violation(db_session, request_id="gov-dash-1")
    _seed_violation(db_session, request_id="gov-dash-2")
    payload = build_ai_governance_dashboard(db_session, hours=24)
    assert payload["policy_violations"] >= 2
    assert payload["open_violations"] >= 2
    assert "top_violated_policies" in payload
    assert "policy_impact" in payload
