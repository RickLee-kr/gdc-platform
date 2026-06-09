"""Replay/failover impact tests for AI policy blocks (M22)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.ai_policy.errors import AiPolicyEnforcementError
from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_TARGET_PROMPT,
)
from app.ai_policy.service import create_ai_policy_rule
from app.ai_streams.models import AiStream
from app.failover_routing.failover_eligibility import is_failover_eligible_error
from app.replay.eligibility import is_replay_record_eligible
from app.replay.models import StreamReplayEvent
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from tests.test_ai_proxy_receiver import _seed_ai_proxy_stack
from tests.test_stream_runner_e2e import _AllowAllLimiter, _FakePoller, _FailIfCalledSyslogSender


def test_policy_block_not_replay_or_failover_eligible() -> None:
    err = AiPolicyEnforcementError("blocked", stage="prompt", action="block", policy_id=1)
    assert is_replay_record_eligible(error=err) is False
    assert is_failover_eligible_error(err) is False


def test_provider_failure_still_replay_eligible(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    stack = _seed_ai_proxy_stack(db_session, slug="policy-replay-split")
    ai_stream = db_session.query(AiStream).filter(AiStream.stream_id == stack["stream_id"]).one()
    create_ai_policy_rule(
        db_session,
        ai_stream_id=int(ai_stream.id),
        name="allow-all",
        enabled=False,
        target=AI_POLICY_TARGET_PROMPT,
        inspection_type=AI_POLICY_INSPECTION_KEYWORD,
        condition_json={"keyword": "never-match"},
        action_type=AI_POLICY_ACTION_BLOCK,
    )
    db_session.commit()

    calls = {"count": 0}

    class _Response:
        def __init__(self, status_code: int) -> None:
            self.status_code = status_code
            self.content = b"{}"

        def json(self) -> dict[str, Any]:
            return {"id": "x", "choices": [{"message": {"content": "ok"}}]}

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *args: Any) -> None:
            _ = args

        def request(self, *args: Any, **kwargs: Any) -> _Response:
            _ = args, kwargs
            calls["count"] += 1
            return _Response(500)

    monkeypatch.setattr("app.ai_providers.adapters.openai.httpx.Client", _Client)

    from app.ai_providers.models import AiProvider

    provider = db_session.query(AiProvider).filter(AiProvider.provider_type == "MOCK").first()
    if provider is None:
        pytest.skip("mock provider missing")
    provider.provider_type = "OPENAI"
    provider.endpoint_url = "https://api.openai.com"
    provider.auth_json = {"api_key": "sk-test"}
    db_session.commit()

    poller = _FakePoller(response={"provider_request": {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}})
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    ctx.stream["source_type"] = "HTTP_API_POLLING"
    runner.run(ctx, db=db_session)

    replay_rows = (
        db_session.query(StreamReplayEvent)
        .filter(StreamReplayEvent.stream_id == stack["stream_id"])
        .all()
    )
    assert replay_rows, "provider failure should still create replay event when policy does not block"
