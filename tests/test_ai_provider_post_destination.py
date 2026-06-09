"""Integration tests for AI_PROVIDER_POST destination adapter (M21.2)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.adapters.ai_provider_post import AiProviderPostDestinationAdapter
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.sources.models import Source
from app.streams.models import Stream
from app.runtime.errors import DestinationSendError
from tests.test_stream_runner_e2e import (
    _AllowAllLimiter,
    _FakePoller,
    _FailIfCalledSyslogSender,
)


def _seed_ai_stream(
    db: Session,
    *,
    provider_type: str = "MOCK",
    retry_count: int = 0,
    endpoint_url: str | None = None,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    resolved_endpoint = endpoint_url or ("mock://local" if provider_type == "MOCK" else "https://api.openai.com")
    provider = AiProvider(
        name="test-provider",
        provider_type=provider_type,
        enabled=True,
        endpoint_url=resolved_endpoint,
        auth_json={"api_key": "sk-test"} if provider_type == "OPENAI" else {},
        default_model="gpt-4o" if provider_type == "OPENAI" else "mock-model",
        timeout_seconds=timeout_seconds,
    )
    db.add(provider)
    db.flush()

    connector = Connector(name="ai-connector", description="ai", status="RUNNING")
    db.add(connector)
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="ai-stream",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/events", "event_array_path": "$.items"},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 10, "per_seconds": 60},
    )
    db.add(stream)
    db.flush()

    mapping = Mapping(
        stream_id=stream.id,
        event_array_path="$.items",
        field_mappings_json={
            "provider_request": "$.provider_request",
        },
        raw_payload_mode="JSON",
    )
    enrichment = Enrichment(stream_id=stream.id, enrichment_json={}, override_policy="KEEP_EXISTING", enabled=True)
    destination = Destination(
        name="ai-dest",
        destination_type="AI_PROVIDER_POST",
        config_json={"provider_id": int(provider.id), "retry_count": retry_count, "retry_backoff_seconds": 0.01},
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
    return {
        "stream_id": int(stream.id),
        "provider_id": int(provider.id),
        "destination_id": int(destination.id),
    }


def test_ai_provider_post_adapter_mock_success(db_session: Session) -> None:
    stack = _seed_ai_stream(db_session, provider_type="MOCK")
    ctx = load_stream_context(db_session, stack["stream_id"])
    adapter = AiProviderPostDestinationAdapter()
    route = ctx.stream["routes"][0]
    config = route["destination"]["config"]
    adapter.send(
        [
            {
                "provider_request": {
                    "model": "mock-model",
                    "messages": [{"role": "user", "content": "hello"}],
                }
            }
        ],
        config,
    )


def test_ai_provider_post_stream_runner_pipeline(db_session: Session) -> None:
    stack = _seed_ai_stream(db_session, provider_type="MOCK")
    poller = _FakePoller(
        response={
            "items": [
                {
                    "provider_request": {
                        "model": "mock-model",
                        "messages": [{"role": "user", "content": "hello"}],
                    }
                }
            ]
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
    assert int(summary.get("delivered_batch_event_count") or 0) >= 1
    logs = (
        db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == stack["stream_id"])
        .order_by(DeliveryLog.id.desc())
        .all()
    )
    assert any(log.stage == "route_send_success" for log in logs)


def test_ai_provider_post_missing_provider_request(db_session: Session) -> None:
    stack = _seed_ai_stream(db_session, provider_type="MOCK")
    ctx = load_stream_context(db_session, stack["stream_id"])
    adapter = AiProviderPostDestinationAdapter()
    config = ctx.stream["routes"][0]["destination"]["config"]
    with pytest.raises(DestinationSendError, match="missing provider_request"):
        adapter.send([{"message": "no provider_request"}], config)


def test_ai_provider_post_openai_retries_on_429(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    stack = _seed_ai_stream(db_session, provider_type="OPENAI", retry_count=1)
    ctx = load_stream_context(db_session, stack["stream_id"])
    config = ctx.stream["routes"][0]["destination"]["config"]
    calls = {"count": 0}

    class _Response:
        def __init__(self, status_code: int) -> None:
            self.status_code = status_code
            self.content = (
                b'{"id":"cmpl-1","model":"gpt-4o","choices":[{"message":{"content":"ok"}}]}'
                if status_code == 200
                else b"{}"
            )

        def json(self) -> dict[str, Any]:
            return {
                "id": "cmpl-1",
                "model": "gpt-4o",
                "choices": [{"message": {"content": "ok"}}],
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
                return _Response(429)
            return _Response(200)

    monkeypatch.setattr("app.ai_providers.adapters.openai.httpx.Client", _Client)
    adapter = AiProviderPostDestinationAdapter()
    adapter.send(
        [
            {
                "provider_request": {
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": "hello"}],
                }
            }
        ],
        config,
    )
    assert calls["count"] == 2
