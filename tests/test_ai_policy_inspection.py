"""Unit tests for AI prompt/response inspection and enforcement (M22)."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.ai_policy.enforcement import enforce_prompt_policy, enforce_response_policy
from app.ai_policy.errors import AiPolicyEnforcementError
from app.ai_policy.inspection import inspect_prompt, inspect_response
from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_PII,
    AI_POLICY_TARGET_PROMPT,
    AI_POLICY_TARGET_RESPONSE,
)
from app.ai_policy.service import create_ai_policy_rule
from tests.ai_policy_test_helpers import seed_ai_stream_for_policy


def test_inspect_prompt_keyword_match(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="inspect-prompt")
    create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="kw-block",
        enabled=True,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "forbidden"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.commit()

    result = inspect_prompt(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        provider_request={"messages": [{"role": "user", "content": "this is forbidden data"}]},
    )
    assert result.policy.decision == AI_POLICY_ACTION_BLOCK


def test_enforce_prompt_block_raises(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="enforce-prompt")
    create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="kw-block",
        enabled=True,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "deny-me"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.commit()

    with pytest.raises(AiPolicyEnforcementError) as exc:
        enforce_prompt_policy(
            db_session,
            ai_stream_id=stack["ai_stream_id"],
            provider_request={"messages": [{"role": "user", "content": "deny-me now"}]},
        )
    assert exc.value.stage == "prompt"


def test_enforce_response_mask(db_session: Session) -> None:
    stack = seed_ai_stream_for_policy(db_session, slug="enforce-response")
    create_ai_policy_rule(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        name="mask-pii",
        enabled=True,
        target=AI_POLICY_TARGET_RESPONSE,
        inspection_type=AI_POLICY_INSPECTION_PII,
        condition_json={},
        action_type=AI_POLICY_ACTION_MASK,
    )
    db_session.commit()

    masked = enforce_response_policy(
        db_session,
        ai_stream_id=stack["ai_stream_id"],
        provider_response={"content": "email user@example.com"},
    )
    assert masked["content"] != "email user@example.com"
    assert "example.com" not in masked["content"]
