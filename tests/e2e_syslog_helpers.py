"""Fixtures and helpers for Syslog TCP/UDP E2E delivery tests (local receivers, no mocks of sender)."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.syslog_receiver import (
    SyslogTcpTestReceiver,
    SyslogUdpTestReceiver,
    parse_compact_json_from_syslog_line,
    wait_for_syslog_json,
)


@pytest.fixture
def syslog_udp_receiver() -> Any:
    recv = SyslogUdpTestReceiver(host="127.0.0.1", port=0)
    recv.start()
    try:
        yield recv
    finally:
        recv.stop()


@pytest.fixture
def syslog_tcp_receiver() -> Any:
    recv = SyslogTcpTestReceiver(host="127.0.0.1", port=0)
    recv.start()
    try:
        yield recv
    finally:
        recv.stop()


def create_syslog_udp_destination(client: TestClient, host: str, port: int, *, name: str | None = None) -> int:
    label = name or f"e2e-syslog-udp-{uuid.uuid4().hex[:10]}"
    dest = client.post(
        "/api/v1/destinations/",
        json={
            "name": label,
            "destination_type": "SYSLOG_UDP",
            "config_json": {
                "host": host,
                "port": int(port),
                "timeout_seconds": 5,
            },
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest.status_code == 201, dest.text
    return int(dest.json()["id"])


def create_syslog_tcp_destination(client: TestClient, host: str, port: int, *, name: str | None = None) -> int:
    label = name or f"e2e-syslog-tcp-{uuid.uuid4().hex[:10]}"
    dest = client.post(
        "/api/v1/destinations/",
        json={
            "name": label,
            "destination_type": "SYSLOG_TCP",
            "config_json": {
                "host": host,
                "port": int(port),
                "timeout_seconds": 5,
            },
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest.status_code == 201, dest.text
    return int(dest.json()["id"])


def create_syslog_tls_destination(
    client: TestClient,
    host: str,
    port: int,
    *,
    name: str | None = None,
    tls_verify_mode: str = "insecure_skip_verify",
    tls_ca_cert_path: str | None = None,
    tls_server_name: str | None = None,
) -> int:
    label = name or f"e2e-syslog-tls-{uuid.uuid4().hex[:10]}"
    cfg: dict[str, Any] = {
        "host": host,
        "port": int(port),
        "tls_enabled": True,
        "tls_verify_mode": tls_verify_mode,
        "timeout_seconds": 5,
    }
    if tls_ca_cert_path:
        cfg["tls_ca_cert_path"] = tls_ca_cert_path
    if tls_server_name:
        cfg["tls_server_name"] = tls_server_name
    dest = client.post(
        "/api/v1/destinations/",
        json={
            "name": label,
            "destination_type": "SYSLOG_TLS",
            "config_json": cfg,
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest.status_code == 201, dest.text
    return int(dest.json()["id"])


def wait_for_syslog_json_duck(
    receiver: Any,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout_seconds: float = 15.0,
    poll_interval_seconds: float = 0.05,
) -> dict[str, Any]:
    """Poll ``receiver.messages()`` until ``predicate`` matches parsed JSON (UDP/TCP/TLS receivers)."""

    deadline = time.monotonic() + float(timeout_seconds)
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        for line in receiver.messages():
            parsed = parse_compact_json_from_syslog_line(line)
            if not parsed:
                continue
            last = parsed
            if predicate(parsed):
                return parsed
        time.sleep(float(poll_interval_seconds))
    raise AssertionError(f"timeout waiting for syslog JSON (last parsed={last!r})")


def wait_for_syslog_message(
    receiver: SyslogUdpTestReceiver | SyslogTcpTestReceiver,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout_seconds: float = 15.0,
) -> dict[str, Any]:
    return wait_for_syslog_json(receiver, predicate, timeout_seconds=timeout_seconds)


def last_syslog_json(receiver: SyslogUdpTestReceiver | SyslogTcpTestReceiver) -> dict[str, Any] | None:
    for line in reversed(receiver.messages()):
        parsed = parse_compact_json_from_syslog_line(line)
        if parsed:
            return parsed
    return None


def assert_syslog_contains_mapped_and_enrichment(ev: dict[str, Any]) -> None:
    assert ev.get("event_id") == "single-root-1"
    assert ev.get("message") == "single object root"
    assert ev.get("severity") == "INFO"
    assert ev.get("vendor") == "GENERIC_REST"
