"""Replay E2E for AI_PROVIDER_POST (M21.4)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.replay.models import REPLAY_STATUS_FAILED, REPLAY_STATUS_PENDING, StreamReplayEvent
from app.replay.service import execute_replay_event
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.sources.models import Source
from app.streams.models import Stream
from tests.test_stream_runner_e2e import _AllowAllLimiter, _FakePoller, _FailIfCalledSyslogSender


def _seed_ai_replay_stack(db: Session) -> dict[str, Any]:
    provider = AiProvider(
        name="replay-openai",
        provider_type="OPENAI",
        enabled=True,
        endpoint_url="https://api.openai.com",
        auth_json={"api_key": "sk-replay"},
        default_model="gpt-4o",
        timeout_seconds=30,
    )
    connector = Connector(name="replay-connector", description="", status="RUNNING")
    db.add_all([provider, connector])
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="ai-replay-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 100, "per_seconds": 60},
    )
    db.add(stream)
    db.flush()

    mapping = Mapping(
        stream_id=stream.id,
        event_array_path=None,
        field_mappings_json={"provider_request": "$.provider_request"},
        raw_payload_mode="JSON",
    )
    enrichment = Enrichment(stream_id=stream.id, enrichment_json={}, override_policy="KEEP_EXISTING", enabled=True)
    destination = Destination(
        name="replay-openai-dest",
        destination_type="AI_PROVIDER_POST",
        config_json={"provider_id": int(provider.id), "retry_count": 0},
        rate_limit_json={"max_events": 100, "per_seconds": 1},
        enabled=True,
    )
    db.add_all([mapping, enrichment, destination])
    db.flush()

    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_success_event": {"event_id": "seed-0"}},
        )
    )
    db.commit()
    return {"stream_id": int(stream.id), "destination_id": int(destination.id)}


def test_ai_provider_replay_recovery(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
) -> None:
    stack = _seed_ai_replay_stack(db_session)
    calls = {"count": 0}

    class _Response:
        def __init__(self, status_code: int) -> None:
            self.status_code = status_code
            self.content = (
                b'{"id":"cmpl-replay","model":"gpt-4o","choices":[{"message":{"content":"recovered"}}]}'
                if status_code == 200
                else b"{}"
            )

        def json(self) -> dict[str, Any]:
            return {
                "id": "cmpl-replay",
                "model": "gpt-4o",
                "choices": [{"message": {"content": "recovered"}}],
            }

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
            if calls["count"] == 1:
                return _Response(500)
            return _Response(200)

    monkeypatch.setattr("app.ai_providers.adapters.openai.httpx.Client", _Client)

    poller = _FakePoller(
        response={
            "provider_request": {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "replay me"}],
            }
        }
    )
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )
    ctx = load_stream_context(db_session, stack["stream_id"])
    summary = runner.run(ctx, db=db_session)
    assert summary["outcome"] == "completed"

    replay_rows = (
        db_session.query(StreamReplayEvent)
        .filter(StreamReplayEvent.stream_id == stack["stream_id"])
        .order_by(StreamReplayEvent.id.asc())
        .all()
    )
    assert replay_rows, "expected replay event after AI provider failure"
    pending = [row for row in replay_rows if row.status in {REPLAY_STATUS_PENDING, REPLAY_STATUS_FAILED}]
    assert pending

    result = execute_replay_event(db_session, int(pending[0].id))
    db_session.commit()
    assert result["outcome"] == "replayed"
    from app.replay.models import REPLAY_STATUS_REPLAYED

    assert result["status"] == REPLAY_STATUS_REPLAYED
