"""Delivery senders apply route ``message_prefix_*`` settings immediately before wire send."""

from __future__ import annotations

from typing import Any

import pytest

from app.delivery.syslog_sender import SyslogSender
from app.delivery.webhook_sender import WebhookSender
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.json_formatter import format_webhook_events
from app.formatters.message_prefix import (
    DEFAULT_MESSAGE_PREFIX_TEMPLATE,
    build_message_prefix_context,
    compact_event_json,
    resolve_message_prefix_template,
)
from app.runtime.errors import DestinationSendError


def _prefixed_line(event: dict, template: str | None = None) -> str:
    t = (template or DEFAULT_MESSAGE_PREFIX_TEMPLATE).rstrip()
    return f"{t} {compact_event_json(event)}"


def test_resolve_message_prefix_template_variables() -> None:
    ctx = build_message_prefix_context(
        stream_name="Stellar Login Stream",
        stream_id=12,
        destination_name="Dest A",
        destination_type="SYSLOG_UDP",
        route_id=99,
        timestamp_iso="2026-05-10T12:00:00Z",
    )
    event = {"event_type": "reconn", "event_name": "n", "vendor": "v", "product": "p"}
    tmpl = "<134> {{stream.name}} {{event.event_type}}:"
    assert resolve_message_prefix_template(tmpl, event=event, context=ctx) == "<134> Stellar Login Stream reconn:"


def test_resolve_message_prefix_unknown_and_missing_event_fields_empty() -> None:
    ctx = build_message_prefix_context(stream_name="S")
    event: dict = {}
    assert (
        resolve_message_prefix_template(
            "{{event.event_type}}-{{unknown}}-{{stream.name}}",
            event=event,
            context=ctx,
        )
        == "--S"
    )


def test_syslog_prefix_resolves_template_at_send(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": {"message_format": "json"},
    }
    ev = {"event_type": "reconn", "id": 1}
    route_override = {
        "message_prefix_enabled": True,
        "message_prefix_template": "<134> {{stream.name}} {{event.event_type}}:",
    }
    pfx = build_message_prefix_context(stream_name="Stellar Login Stream", stream_id=1)
    SyslogSender().send(
        [ev],
        cfg,
        formatter_override=route_override,
        destination_type="SYSLOG_UDP",
        prefix_context=pfx,
    )
    assert sent == [
        "<134> Stellar Login Stream reconn: {\"event_type\":\"reconn\",\"id\":1}".encode("utf-8")
    ]


def test_webhook_prefix_resolves_template_at_send(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[Any] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            posted.append({"json": json, "content": content})
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    events = [{"event_type": "x", "n": 1}]
    pfx = build_message_prefix_context(destination_name="Hook", destination_type="WEBHOOK_POST")
    WebhookSender().send(
        events,
        {"url": "https://receiver.example.com/hook", "retry_count": 0},
        formatter_override={
            "message_prefix_enabled": True,
            "message_prefix_template": "{{destination.name}} {{event.event_type}}:",
        },
        prefix_context=pfx,
    )
    assert posted[0]["content"] == b'Hook x: {"event_type":"x","n":1}'


def test_syslog_udp_sends_format_syslog_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    formatter_cfg = {
        "message_format": "json",
        "syslog": {
            "hostname": "gdc",
            "app_name": "generic-connector",
            "tag": "acme_edr",
        },
    }
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": formatter_cfg,
    }
    events = [{"event_id": "evt-1", "message": "hello"}]

    SyslogSender().send(events, cfg)

    assert sent == [_prefixed_line(events[0]).encode("utf-8")]


def test_syslog_tcp_destination_type_overrides_stale_udp_in_config(monkeypatch: pytest.MonkeyPatch) -> None:
    chunks: list[bytes] = []

    class _TcpSock:
        def __enter__(self) -> _TcpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def sendall(self, data: bytes) -> None:
            chunks.append(data)

    udp_calls: list[tuple] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, addr: tuple[str, int]) -> None:
            udp_calls.append((data, addr))

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.create_connection",
        lambda _addr, timeout=None: _TcpSock(),
    )
    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": {"message_format": "json", "syslog": {"hostname": "h", "app_name": "a", "tag": "t"}},
    }
    events = [{"k": "v"}]

    SyslogSender().send(events, cfg, destination_type="SYSLOG_TCP")

    assert not udp_calls
    assert chunks == [_prefixed_line(events[0]).encode("utf-8") + b"\n"]


def test_syslog_tcp_inferred_from_destination_type_when_protocol_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    chunks: list[bytes] = []

    class _TcpSock:
        def __enter__(self) -> _TcpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def sendall(self, data: bytes) -> None:
            chunks.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.create_connection",
        lambda _addr, timeout=None: _TcpSock(),
    )

    formatter_cfg = {
        "message_format": "json",
        "syslog": {"hostname": "gdc", "app_name": "generic-connector", "tag": "t"},
    }
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "formatter_config": formatter_cfg,
    }
    events = [{"k": "v"}]

    SyslogSender().send(events, cfg, destination_type="SYSLOG_TCP")

    assert chunks == [_prefixed_line(events[0]).encode("utf-8") + b"\n"]


def test_syslog_tcp_sends_format_syslog_bytes_with_newline(monkeypatch: pytest.MonkeyPatch) -> None:
    chunks: list[bytes] = []

    class _TcpSock:
        def __enter__(self) -> _TcpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def sendall(self, data: bytes) -> None:
            chunks.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.create_connection",
        lambda _addr, timeout=None: _TcpSock(),
    )

    formatter_cfg = {
        "message_format": "json",
        "syslog": {
            "hostname": "gdc",
            "app_name": "generic-connector",
            "tag": "t",
        },
    }
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "tcp",
        "formatter_config": formatter_cfg,
    }
    events = [{"k": "v"}]

    SyslogSender().send(events, cfg)

    assert chunks == [_prefixed_line(events[0]).encode("utf-8") + b"\n"]


def test_syslog_rejects_non_json_message_format() -> None:
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 514,
        "protocol": "udp",
        "formatter_config": {"message_format": "cef"},
    }
    with pytest.raises(DestinationSendError, match="message_format"):
        SyslogSender().send([{"a": 1}], cfg)


def test_syslog_flat_formatter_keys_in_destination_config(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "message_format": "json",
        "hostname": "gdc",
        "app_name": "generic-connector",
        "tag": "flat",
    }
    events = [{"x": 1}]
    expected = _prefixed_line(events[0])
    SyslogSender().send(events, cfg)
    assert sent == [expected.encode("utf-8")]


def test_webhook_post_json_default_single_object_per_request(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[Any] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            posted.append({"url": url, "headers": headers, "json": json, "content": content})
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    events = [{"id": 1}, {"id": 2}]
    WebhookSender().send(events, {"url": "https://receiver.example.com/hook"})

    assert len(posted) == 2
    assert posted[0]["json"] == {"id": 1}
    assert posted[1]["json"] == {"id": 2}


def test_webhook_post_json_batch_array_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[Any] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            posted.append({"url": url, "headers": headers, "json": json, "content": content})
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    events = [{"id": 1}, {"id": 2}]
    WebhookSender().send(
        events,
        {"url": "https://receiver.example.com/hook", "payload_mode": "BATCH_JSON_ARRAY"},
    )

    assert len(posted) == 1
    assert posted[0]["json"] == format_webhook_events(events)


def test_webhook_batches_use_formatter_per_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    bodies: list[Any] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            bodies.append({"json": json, "content": content})
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    events = [{"n": 0}, {"n": 1}, {"n": 2}]
    WebhookSender().send(
        events,
        {
            "url": "https://receiver.example.com/hook",
            "batch_size": 2,
            "retry_count": 0,
            "payload_mode": "BATCH_JSON_ARRAY",
        },
    )

    assert bodies == [
        {"json": format_webhook_events(events[0:2]), "content": None},
        {"json": format_webhook_events(events[2:3]), "content": None},
    ]


def test_syslog_route_formatter_override_beats_destination(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    destination_formatter = {
        "message_format": "json",
        "syslog": {"hostname": "dest", "app_name": "generic-connector", "tag": "dest_tag"},
    }
    route_override = {
        "message_prefix_enabled": True,
        "message_prefix_template": "<134> routehost generic-connector route_tag:",
    }
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": destination_formatter,
    }
    events = [{"id": 1}]
    SyslogSender().send(events, cfg, formatter_override=route_override)
    expected = _prefixed_line(
        events[0],
        template="<134> routehost generic-connector route_tag:",
    ).encode("utf-8")
    assert sent == [expected]


def test_syslog_empty_route_override_falls_back_to_destination_formatter(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    destination_formatter = {
        "message_format": "json",
        "syslog": {"tag": "from_destination"},
    }
    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": destination_formatter,
    }
    events = [{"id": 1}]
    SyslogSender().send(events, cfg, formatter_override={})
    expected = _prefixed_line(events[0]).encode("utf-8")
    assert sent == [expected]


def test_syslog_prefix_disabled_sends_compact_json_only(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []

    class _UdpSock:
        def __enter__(self) -> _UdpSock:
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def settimeout(self, _t: float) -> None:
            pass

        def sendto(self, data: bytes, _addr: tuple[str, int]) -> None:
            sent.append(data)

    monkeypatch.setattr(
        "app.delivery.syslog_sender.socket.socket",
        lambda *_a, **_k: _UdpSock(),
    )

    cfg: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 5514,
        "protocol": "udp",
        "formatter_config": {"message_format": "json"},
    }
    events = [{"n": 7}]
    SyslogSender().send(
        events,
        cfg,
        formatter_override={"message_prefix_enabled": False},
        destination_type="SYSLOG_UDP",
    )
    assert sent == [compact_event_json(events[0]).encode("utf-8")]


def test_webhook_prefix_enabled_posts_plain_text(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[Any] = []

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            posted.append({"url": url, "headers": headers, "json": json, "content": content})
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    events = [{"id": 9}]
    WebhookSender().send(
        events,
        {"url": "https://receiver.example.com/hook", "retry_count": 0},
        formatter_override={"message_prefix_enabled": True},
    )

    assert len(posted) == 1
    assert posted[0]["json"] is None
    exp = f"{DEFAULT_MESSAGE_PREFIX_TEMPLATE.rstrip()} {compact_event_json(events[0])}".encode("utf-8")
    assert posted[0]["content"] == exp
    assert posted[0]["headers"].get("Content-Type") == "text/plain; charset=utf-8"


def test_resolve_formatter_config_route_none_uses_destination_then_flat() -> None:
    dest = {
        "host": "h",
        "formatter_config": {"message_format": "json", "syslog": {"tag": "dt"}},
    }
    assert resolve_formatter_config(dest, None)["syslog"]["tag"] == "dt"

    flat_only = {"message_format": "json", "tag": "flat"}
    assert resolve_formatter_config(flat_only, None)["tag"] == "flat"

    dest2 = {"formatter_config": {"message_format": "json", "syslog": {"tag": "dt"}}}
    assert resolve_formatter_config(dest2, {"message_prefix_enabled": True})["syslog"]["tag"] == "dt"


def test_webhook_sender_calls_resolve_with_route_override(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[dict[str, Any], dict[str, Any] | None]] = []

    def _spy(
        destination_config: dict[str, Any],
        route_formatter_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        calls.append((destination_config, route_formatter_config))
        return resolve_formatter_config(destination_config, route_formatter_config)

    monkeypatch.setattr("app.delivery.webhook_sender.resolve_formatter_config", _spy)

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(
            self,
            url: str,
            headers: dict[str, str] | None = None,
            json: Any = None,
            content: bytes | None = None,
        ) -> _FakeResponse:
            return _FakeResponse()

    monkeypatch.setattr("app.delivery.webhook_sender.httpx.Client", _FakeClient)

    route_ov = {"message_format": "json", "syslog": {"tag": "r"}}
    WebhookSender().send(
        [{"x": 1}],
        {"url": "https://receiver.example.com/hook", "formatter_config": {"message_format": "json"}},
        formatter_override=route_ov,
    )

    assert len(calls) == 1
    assert calls[0][1] == route_ov
