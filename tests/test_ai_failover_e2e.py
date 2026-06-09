"""Failover E2E for AI_PROVIDER_POST (M21.4)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.failover_routing.operator_workflow import create_failover_route
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.runtime.errors import DestinationSendError
from app.sources.models import Source
from app.streams.models import Stream
from tests.test_stream_runner_e2e import _AllowAllLimiter, _FakePoller, _FailIfCalledSyslogSender


def _seed_ai_failover_stack(db: Session) -> dict[str, Any]:
    primary_provider = AiProvider(
        name="primary-openai",
        provider_type="OPENAI",
        enabled=True,
        endpoint_url="https://api.openai.com",
        auth_json={"api_key": "sk-primary"},
        default_model="gpt-4o",
        timeout_seconds=30,
    )
    secondary_provider = AiProvider(
        name="secondary-mock",
        provider_type="MOCK",
        enabled=True,
        endpoint_url="mock://local",
        auth_json={},
        default_model="mock-model",
        timeout_seconds=30,
    )
    connector = Connector(name="failover-connector", description="", status="RUNNING")
    db.add_all([primary_provider, secondary_provider, connector])
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
        name="ai-failover-stream",
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
    primary_dest = Destination(
        name="primary-openai-dest",
        destination_type="AI_PROVIDER_POST",
        config_json={"provider_id": int(primary_provider.id), "retry_count": 0},
        rate_limit_json={"max_events": 100, "per_seconds": 1},
        enabled=True,
    )
    secondary_dest = Destination(
        name="secondary-mock-dest",
        destination_type="AI_PROVIDER_POST",
        config_json={"provider_id": int(secondary_provider.id), "retry_count": 0},
        rate_limit_json={"max_events": 100, "per_seconds": 1},
        enabled=True,
    )
    db.add_all([mapping, enrichment, primary_dest, secondary_dest])
    db.flush()

    route = Route(
        stream_id=stream.id,
        destination_id=primary_dest.id,
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
    db.flush()
    create_failover_route(
        db,
        stream_id=int(stream.id),
        primary_destination_id=int(primary_dest.id),
        secondary_destination_id=int(secondary_dest.id),
        enabled=True,
    )
    db.commit()
    return {"stream_id": int(stream.id), "primary_provider_id": int(primary_provider.id)}


def test_ai_provider_failover_primary_500_secondary_mock(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
) -> None:
    stack = _seed_ai_failover_stack(db_session)

    class _Response:
        status_code = 500
        content = b"{}"

        def json(self) -> dict[str, Any]:
            return {"error": {"message": "server error"}}

    class _Client:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            _ = args, kwargs

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *args: Any) -> None:
            _ = args

        def request(self, *args: Any, **kwargs: Any) -> _Response:
            _ = args, kwargs
            return _Response()

    monkeypatch.setattr("app.ai_providers.adapters.openai.httpx.Client", _Client)

    poller = _FakePoller(
        response={
            "provider_request": {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "failover please"}],
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

    stages = [
        str(row.stage)
        for row in db_session.query(DeliveryLog)
        .filter(DeliveryLog.stream_id == stack["stream_id"])
        .order_by(DeliveryLog.id.asc())
        .all()
    ]
    assert "failover_route_attempt" in stages
    assert "failover_route_send_success" in stages


def test_failover_eligible_for_ai_provider_timeout() -> None:
    from app.failover_routing.failover_eligibility import is_failover_eligible_error

    assert is_failover_eligible_error(DestinationSendError("timeout", http_status=504)) is True
    assert is_failover_eligible_error(DestinationSendError("rate limited", http_status=429)) is False
