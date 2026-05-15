from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.main import app


def test_http_api_test_returns_raw_and_extracted_preview(monkeypatch) -> None:
    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method, url, **kwargs):  # noqa: ANN001
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json={"items": [{"id": "evt-1"}, {"id": "evt-2"}], "meta": {"ok": True}})

    monkeypatch.setattr("app.connectors.auth_execute.httpx.Client", lambda *a, **k: _Client())
    client = TestClient(app)

    response = client.post(
        "/api/v1/runtime/api-test/http",
        json={
            "source_config": {"base_url": "https://api.example.com"},
            "stream_config": {"method": "GET", "endpoint": "/events", "event_array_path": "$.items"},
            "checkpoint": {"cursor": "1"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["response"]["parsed_json"]["meta"]["ok"] is True
    assert body["response"]["status_code"] == 200


def test_http_api_test_returns_clear_error_on_fetch_failure(monkeypatch) -> None:
    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method, url, **kwargs):  # noqa: ANN001
            raise httpx.TimeoutException("timed out during request")

    monkeypatch.setattr("app.connectors.auth_execute.httpx.Client", lambda *a, **k: _Client())
    client = TestClient(app)

    response = client.post(
        "/api/v1/runtime/api-test/http",
        json={
            "source_config": {"base_url": "https://api.example.com"},
            "stream_config": {"endpoint": "/events"},
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error_type"] == "timeout"


def test_http_api_test_returns_extraction_error(monkeypatch) -> None:
    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method, url, **kwargs):  # noqa: ANN001
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json=[1, 2, 3])

    monkeypatch.setattr("app.connectors.auth_execute.httpx.Client", lambda *a, **k: _Client())
    client = TestClient(app)

    response = client.post(
        "/api/v1/runtime/api-test/http",
        json={
            "source_config": {"base_url": "https://api.example.com"},
            "stream_config": {"endpoint": "/events"},
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_http_api_test_actual_request_sent_keeps_body_size_with_query_limit(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def request(self, method, url, **kwargs):  # noqa: ANN001
            captured["method"] = method
            captured["url"] = url
            captured["kwargs"] = kwargs
            req = httpx.Request(method, url)
            return httpx.Response(200, request=req, json={"hits": {"hits": [{"_id": "evt-1"}]}})

    monkeypatch.setattr("app.connectors.auth_execute.httpx.Client", lambda *a, **k: _Client())
    client = TestClient(app)

    response = client.post(
        "/api/v1/runtime/api-test/http",
        json={
            "source_config": {"base_url": "https://api.example.com"},
            "stream_config": {
                "method": "GET",
                "endpoint": "/_search",
                "params": {"limit": "10"},
                "body": {"size": 1, "query": {"bool": {"filter": []}}},
            },
            "fetch_sample": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert captured["method"] == "GET"
    assert captured["kwargs"]["json"]["size"] == 1
    assert "limit" not in captured["kwargs"]["json"]
    assert body["actual_request_sent"]["query_params"]["limit"] == "10"
    assert body["actual_request_sent"]["json_body_masked"]["size"] == 1
