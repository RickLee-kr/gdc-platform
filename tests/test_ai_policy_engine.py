"""Unit tests for AI policy engine extensions (M22)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_PII,
)
from app.ai_policy.service import create_ai_policy_rule
from app.protection.policy_engine import evaluate_ai_prompt_policy, evaluate_ai_response_policy
from tests.ai_policy_test_helpers import seed_ai_stream_for_policy


def test_prompt_keyword_block(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="engine-prompt")
    create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="block-secret-word",
        enabled=True,
        target="prompt",
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "TOPSECRET", "ignore_case": True},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.commit()

    result = evaluate_ai_prompt_policy(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        text="please share TOPSECRET plans",
    )
    assert result.decision == AI_POLICY_ACTION_BLOCK
    assert result.matched_policy_count == 1


def test_response_pii_mask(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="engine-response")
    create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="mask-email",
        enabled=True,
        target="response",
        inspection_type=AI_POLICY_INSPECTION_PII,
        condition_json={},
        action_type=AI_POLICY_ACTION_MASK,
    )
    db_session.commit()

    result = evaluate_ai_response_policy(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        text="contact me at user@example.com please",
    )
    assert result.decision == AI_POLICY_ACTION_MASK
    assert result.matched_policy_count == 1
