"""HttpPoller / WebhookSender use shared HTTP resilience classification."""

from __future__ import annotations

import httpx
import pytest

from app.delivery.webhook_sender import WebhookSender
from app.pollers.http_poller import HttpPoller
from app.runtime.errors import DestinationSendError, SourceFetchError


def _source_cfg() -> dict:
    return {"base_url": "https://src.test", "common_headers": {}}


def _stream_cfg(**overrides: object) -> dict:
    cfg: dict = {
        "method": "GET",
        "endpoint": "/events",
        "params": {},
        "retry_count": 2,
        "retry_backoff_seconds": 0,
    }
    cfg.update(overrides)
    return cfg


def _patch_poller_client(monkeypatch: pytest.MonkeyPatch, handler):
    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
            return handler(method, url, **kwargs)

    monkeypatch.setattr("app.pollers.http_poller.httpx.Client", _Client)
    monkeypatch.setattr(
        "app.pollers.http_poller._apply_auth_to_request",
        lambda auth, h, p, *rest: (h, p),
    )


def test_poller_retries_5xx_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls["n"] += 1
        req = httpx.Request(method, url)
        if calls["n"] == 1:
            return httpx.Response(503, request=req, json={"err": "busy"})
        return httpx.Response(200, request=req, json={"ok": True})

    _patch_poller_client(monkeypatch, handler)
    monkeypatch.setattr("app.pollers.http_poller.time.sleep", lambda s: sleeps.append(float(s)))

    out = HttpPoller().fetch(_source_cfg(), _stream_cfg(), None)
    assert out == {"ok": True}
    assert calls["n"] == 2
    assert sleeps == [0.0]


def test_poller_retries_408(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def handler(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls["n"] += 1
        req = httpx.Request(method, url)
        if calls["n"] < 3:
            return httpx.Response(408, request=req)
        return httpx.Response(200, request=req, json={"items": []})

    _patch_poller_client(monkeypatch, handler)
    monkeypatch.setattr("app.pollers.http_poller.time.sleep", lambda s: None)

    out = HttpPoller().fetch(_source_cfg(), _stream_cfg(retry_count=2), None)
    assert out == {"items": []}
    assert calls["n"] == 3


def test_poller_429_uses_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls["n"] += 1
        req = httpx.Request(method, url)
        if calls["n"] == 1:
            return httpx.Response(429, request=req, headers={"Retry-After": "9"})
        return httpx.Response(200, request=req, json={"ok": 1})

    _patch_poller_client(monkeypatch, handler)
    monkeypatch.setattr("app.pollers.http_poller.time.sleep", lambda s: sleeps.append(float(s)))

    out = HttpPoller().fetch(_source_cfg(), _stream_cfg(retry_backoff_seconds=1), None)
    assert out == {"ok": 1}
    assert sleeps == [9.0]


def test_poller_timeout_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def handler(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("read timed out")
        req = httpx.Request(method, url)
        return httpx.Response(200, request=req, json={"recovered": True})

    _patch_poller_client(monkeypatch, handler)
    monkeypatch.setattr("app.pollers.http_poller.time.sleep", lambda s: None)

    out = HttpPoller().fetch(_source_cfg(), _stream_cfg(), None)
    assert out == {"recovered": True}
    assert calls["n"] == 2


def test_poller_4xx_fatal_no_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def handler(method: str, url: str, **kwargs: object) -> httpx.Response:
        calls["n"] += 1
        req = httpx.Request(method, url)
        return httpx.Response(400, request=req, json={"error": "bad"})

    _patch_poller_client(monkeypatch, handler)
    monkeypatch.setattr("app.pollers.http_poller.time.sleep", lambda s: None)

    with pytest.raises(SourceFetchError) as excinfo:
        HttpPoller().fetch(_source_cfg(), _stream_cfg(), None)
    assert calls["n"] == 1
    assert excinfo.value.detail.get("response_status") == 400


class _FakePoolClient:
    def __init__(self) -> None:
        self.calls = 0
        self._handler = None

    def set_handler(self, handler) -> None:
        self._handler = handler

    def post(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls += 1
        assert self._handler is not None
        return self._handler(url, **kwargs)


def _patch_webhook_client(monkeypatch: pytest.MonkeyPatch, client: _FakePoolClient) -> None:
    monkeypatch.setattr(
        "app.delivery.webhook_sender._borrow_httpx_client",
        lambda **kwargs: client,
    )
    monkeypatch.setattr("app.delivery.webhook_sender._invalidate_httpx_client", lambda key: None)
    monkeypatch.setattr("app.delivery.webhook_sender.time.sleep", lambda s: None)


def test_webhook_retries_5xx_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakePoolClient()
    states = {"n": 0}

    def handler(url: str, **kwargs: object) -> httpx.Response:
        states["n"] += 1
        req = httpx.Request("POST", url)
        if states["n"] == 1:
            return httpx.Response(502, request=req)
        return httpx.Response(200, request=req, json={"ok": True})

    client.set_handler(handler)
    _patch_webhook_client(monkeypatch, client)

    WebhookSender().send(
        [{"id": 1}],
        {"url": "https://dest.test/hook", "retry_count": 2, "retry_backoff_seconds": 0},
    )
    assert states["n"] == 2


def test_webhook_429_uses_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakePoolClient()
    sleeps: list[float] = []
    states = {"n": 0}

    def handler(url: str, **kwargs: object) -> httpx.Response:
        states["n"] += 1
        req = httpx.Request("POST", url)
        if states["n"] == 1:
            return httpx.Response(429, request=req, headers={"Retry-After": "5"})
        return httpx.Response(204, request=req)

    client.set_handler(handler)
    monkeypatch.setattr(
        "app.delivery.webhook_sender._borrow_httpx_client",
        lambda **kwargs: client,
    )
    monkeypatch.setattr("app.delivery.webhook_sender._invalidate_httpx_client", lambda key: None)
    monkeypatch.setattr("app.delivery.webhook_sender.time.sleep", lambda s: sleeps.append(float(s)))

    WebhookSender().send(
        [{"id": 1}],
        {"url": "https://dest.test/hook", "retry_count": 1, "retry_backoff_seconds": 99},
    )
    assert sleeps == [5.0]
    assert states["n"] == 2


def test_webhook_timeout_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakePoolClient()
    states = {"n": 0}

    def handler(url: str, **kwargs: object) -> httpx.Response:
        states["n"] += 1
        if states["n"] == 1:
            raise httpx.ConnectTimeout("connect timed out")
        req = httpx.Request("POST", url)
        return httpx.Response(200, request=req)

    client.set_handler(handler)
    _patch_webhook_client(monkeypatch, client)

    WebhookSender().send(
        [{"id": 1}],
        {"url": "https://dest.test/hook", "retry_count": 1, "retry_backoff_seconds": 0},
    )
    assert states["n"] == 2


def test_webhook_4xx_fatal_no_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakePoolClient()
    states = {"n": 0}

    def handler(url: str, **kwargs: object) -> httpx.Response:
        states["n"] += 1
        req = httpx.Request("POST", url)
        return httpx.Response(400, request=req)

    client.set_handler(handler)
    _patch_webhook_client(monkeypatch, client)

    with pytest.raises(DestinationSendError) as excinfo:
        WebhookSender().send(
            [{"id": 1}],
            {"url": "https://dest.test/hook", "retry_count": 3, "retry_backoff_seconds": 0},
        )
    assert states["n"] == 1
    assert excinfo.value.http_status == 400
