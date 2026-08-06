"""StreamRunner delivery path applies advanced enrichment rules (not preview-only)."""

from __future__ import annotations

from typing import Any

import pytest

from app.runtime.stream_context import StreamContext
from app.runners.stream_runner import StreamRunner


@pytest.fixture(autouse=True)
def _disable_isolated_lifecycle_db_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fake-db unit test: avoid delivery_logs FK writes from isolated sessions."""

    monkeypatch.setattr(StreamRunner, "_commit_lifecycle_entry", lambda self, **_kw: None)
    monkeypatch.setattr(StreamRunner, "_persist_failure_telemetry", lambda self, _payload: None)


class _AllowAllLimiter:
    def allow(self, _value: int, rate_limit_json: dict[str, Any] | None = None) -> bool:
        return True


class _HttpPoller:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.last_checkpoint: dict[str, Any] | None = None

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        self.last_checkpoint = checkpoint
        return self._payload


class _CapturingWebhookSender:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        self.calls.append({"events": list(events), "config": dict(config)})


class _CheckpointSvc:
    def __init__(self) -> None:
        self.updated_db: list[tuple[int, str, dict[str, Any]]] = []

    def get_checkpoint(self, db: Any, stream_id: int) -> dict[str, Any] | None:
        return {"type": "EVENT_ID", "value": {"last_id": "0"}}

    def get_checkpoint_for_stream(self, stream_id: int) -> dict[str, Any] | None:
        return None

    def update(self, stream_id: int, last_success_event: dict[str, Any]) -> None:
        return None

    def update_checkpoint_after_success(
        self,
        db: Any,
        stream_id: int,
        checkpoint_type: str,
        checkpoint_value: dict[str, Any],
    ) -> dict[str, Any]:
        self.updated_db.append((stream_id, checkpoint_type, checkpoint_value))
        return checkpoint_value


def _advanced_enrichment_config() -> dict[str, Any]:
    return {
        "tenant": "acme-corp",
        "__rules": {
            "metadata.severity": {
                "type": "calculated",
                "expression": "eventName.includes('Delete') ? 8 : 5",
                "enabled": True,
            },
            "metadata.region_name": {
                "type": "lookup",
                "lookup_table": "aws_regions",
                "lookup_key_field": "region",
                "enabled": True,
            },
            "metadata.outcome": {
                "type": "conditional",
                "conditions": [{"when": "severity == high", "then": "alert"}],
                "default": "info",
                "enabled": True,
            },
            "metadata.timestamp": {
                "type": "normalize",
                "source_field": "created_at",
                "format": "iso8601",
                "enabled": True,
            },
        },
    }


def _build_advanced_enrichment_context() -> StreamContext:
    stream = {
        "id": 42,
        "connector_id": 1,
        "enabled": True,
        "status": "RUNNING",
        "source_type": "HTTP_API_POLLING",
        "source_config": {"base_url": "https://api.example.com"},
        "stream_config": {"endpoint": "/events", "event_array_path": "$.items"},
        "event_array_path": "$.items",
        "field_mappings": {
            "event_id": "$.id",
            "eventName": "$.eventName",
            "region": "$.region",
            "status": "$.status",
            "severity": "$.severity",
            "created_at": "$.created_at",
        },
        "enrichment": _advanced_enrichment_config(),
        "override_policy": "KEEP_EXISTING",
        "routes": [
            {
                "id": 100,
                "enabled": True,
                "failure_policy": "LOG_AND_CONTINUE",
                "formatter_config_json": {},
                "rate_limit_json": {},
                "destination": {
                    "id": 200,
                    "destination_type": "WEBHOOK_POST",
                    "config": {"url": "https://receiver.example.com/events"},
                    "enabled": True,
                    "rate_limit_json": {},
                },
            }
        ],
    }
    return StreamContext(
        stream=stream,
        source={},
        mapping=None,
        enrichment=None,
        routes=stream["routes"],
        destinations_by_route={100: stream["routes"][0]["destination"]},
        checkpoint={"type": "EVENT_ID", "value": {"last_id": "0"}},
    )


def test_stream_runner_delivers_advanced_enrichment_rules_on_webhook_payload() -> None:
    """Prove enrichment runs in StreamRunner before destination send (not preview-only)."""

    fetch_payload = {
        "items": [
            {
                "id": "evt-adv-delivery-1",
                "eventName": "CreateBucket",
                "region": "us-east-1",
                "status": "success",
                "severity": "high",
                "created_at": "2026-01-15T10:00:00Z",
            }
        ]
    }
    poller = _HttpPoller(fetch_payload)
    sender = _CapturingWebhookSender()
    checkpoint_service = _CheckpointSvc()
    runner = StreamRunner(
        poller=poller,
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        checkpoint_service=checkpoint_service,
        webhook_sender=sender,
        syslog_sender=_CapturingWebhookSender(),
    )
    context = _build_advanced_enrichment_context()
    db = type("DB", (), {"query": lambda self, model: None})()

    summary = runner.run(context, db=db)

    assert summary["delivered_batch_event_count"] == 1
    assert summary["checkpoint_updated"] is True
    assert len(sender.calls) == 1

    delivered = sender.calls[0]["events"][0]
    assert delivered["event_id"] == "evt-adv-delivery-1"
    assert delivered["eventName"] == "CreateBucket"

    assert "__rules" not in delivered
    assert "__computed" not in delivered

    assert delivered["tenant"] == "acme-corp"

    metadata = delivered["metadata"]
    assert isinstance(metadata, dict)
    assert metadata["severity"] == 5
    assert metadata["region_name"] == "US East (N. Virginia)"
    assert metadata["outcome"] == "alert"
    assert str(metadata["timestamp"]).startswith("2026-01-15")
