"""Webhook ``payload_mode`` resolution, preview bodies, and destination API validation."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.delivery.webhook_payload_mode import (
    WEBHOOK_PAYLOAD_MODE_BATCH,
    WEBHOOK_PAYLOAD_MODE_SINGLE,
    normalize_webhook_payload_mode,
    resolve_webhook_payload_mode,
)
from app.formatters.json_formatter import build_webhook_http_preview_messages
from app.main import app


def test_resolve_webhook_payload_mode_defaults_single() -> None:
    assert resolve_webhook_payload_mode({}) == WEBHOOK_PAYLOAD_MODE_SINGLE
    assert resolve_webhook_payload_mode({"payload_mode": None}) == WEBHOOK_PAYLOAD_MODE_SINGLE


def test_normalize_webhook_payload_mode_invalid() -> None:
    with pytest.raises(ValueError, match="Invalid webhook payload_mode"):
        normalize_webhook_payload_mode("ARRAY")


def test_build_webhook_http_preview_messages_single_vs_batch() -> None:
    ev = [{"a": 1}, {"a": 2}]
    assert build_webhook_http_preview_messages(ev, WEBHOOK_PAYLOAD_MODE_SINGLE) == [{"a": 1}, {"a": 2}]
    assert build_webhook_http_preview_messages(ev, WEBHOOK_PAYLOAD_MODE_BATCH) == [[{"a": 1}, {"a": 2}]]


def test_format_preview_webhook_two_events_default_single() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"x": 1}, {"x": 2}],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message_count"] == 2
    assert body["preview_messages"] == [{"x": 1}, {"x": 2}]


def test_format_preview_webhook_batch_mode() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"x": 1}, {"x": 2}],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
            "payload_mode": "BATCH_JSON_ARRAY",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message_count"] == 1
    assert body["preview_messages"] == [[{"x": 1}, {"x": 2}]]


def test_format_preview_prefix_webhook_single_final_payload() -> None:
    client = TestClient(app)
    sample = {"event_type": "reconn"}
    r = client.post(
        "/api/v1/runtime/format-preview",
        json={
            "formatter_config": {"message_prefix_enabled": False},
            "sample_event": sample,
            "destination_type": "WEBHOOK_POST",
            "stream": {},
            "destination": {"payload_mode": "SINGLE_EVENT_OBJECT"},
            "route": {},
        },
    )
    assert r.status_code == 200
    assert r.json()["final_payload"] == json.dumps(sample, separators=(",", ":"))


def test_format_preview_prefix_webhook_batch_final_payload() -> None:
    client = TestClient(app)
    sample = {"event_type": "reconn"}
    r = client.post(
        "/api/v1/runtime/format-preview",
        json={
            "formatter_config": {"message_prefix_enabled": False},
            "sample_event": sample,
            "destination_type": "WEBHOOK_POST",
            "stream": {},
            "destination": {"payload_mode": "BATCH_JSON_ARRAY"},
            "route": {},
        },
    )
    assert r.status_code == 200
    assert r.json()["final_payload"] == json.dumps([sample], separators=(",", ":"))


def test_destinations_post_rejects_payload_mode_on_syslog() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/v1/destinations/",
        json={
            "name": "bad-syslog",
            "destination_type": "SYSLOG_UDP",
            "config_json": {"host": "127.0.0.1", "port": 514, "protocol": "udp", "payload_mode": "BATCH_JSON_ARRAY"},
        },
    )
    assert r.status_code == 422


def test_destinations_post_rejects_invalid_webhook_payload_mode() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/v1/destinations/",
        json={
            "name": "bad-hook",
            "destination_type": "WEBHOOK_POST",
            "config_json": {"url": "https://example.com/h", "payload_mode": "NOT_A_MODE"},
        },
    )
    assert r.status_code == 422
