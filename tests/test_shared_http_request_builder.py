"""Shared HTTP request builder — normalization, pagination suppression, preview parity."""

from __future__ import annotations

import json

import httpx
from app.http.shared_request_builder import (
    body_preview_for_snapshot,
    build_outbound_debug_detail,
    build_shared_http_request,
)
from app.pollers.http_query_params import httpx_body_kwargs, outbound_body_for_debug
from app.runtime.preview_service import _apply_auth_to_request, _normalize_auth
from app.security.secrets import mask_http_headers


def test_json_string_body_not_double_encoded_for_httpx() -> None:
    """String holding JSON object must serialize as JSON object, not quoted JSON string."""

    raw = json.dumps({"nested": True})
    kw = httpx_body_kwargs(raw, None)
    sent = outbound_body_for_debug(kw)
    assert sent == {"nested": True}
    assert isinstance(sent, dict)


def test_get_with_json_body_keeps_json_payload() -> None:
    stm = {
        "endpoint": "/search",
        "method": "GET",
        "body": {"query": "abc"},
    }
    src = {"base_url": "https://vendor.example"}
    kw = httpx_body_kwargs(
        build_shared_http_request(
            source_config=src,
            stream_config=stm,
            mode="runtime",
            checkpoint_value={},
        ).normalized_json_body,
        {"Accept": "application/json"},
    )
    assert "json" in kw
    assert kw["json"] == {"query": "abc"}


def test_pagination_none_does_not_add_cursor_limit_placeholders() -> None:
    stm = {
        "endpoint": "/events",
        "method": "GET",
        "pagination": {"type": "none"},
        "params": {
            "limit": "{{checkpoint.limit}}",
            "cursor": "{{checkpoint.cursor}}",
            "fixed": "ok",
        },
    }
    src = {"base_url": "https://stellar.example"}
    plan = build_shared_http_request(
        source_config=src,
        stream_config=stm,
        mode="runtime",
        checkpoint_value={"limit": "99", "cursor": "tok"},
    )
    assert "limit" not in plan.params
    assert "cursor" not in plan.params
    assert plan.params.get("fixed") == "ok"


def test_runtime_and_api_test_plan_match_without_checkpoint_templates() -> None:
    src = {"base_url": "https://api.example", "headers": {"X": "1"}}
    stm = {
        "endpoint": "/v1/items",
        "method": "POST",
        "headers": {"Y": "2"},
        "params": {"q": "x"},
        "body": {"filter": "all"},
    }
    r = build_shared_http_request(source_config=src, stream_config=stm, mode="runtime", checkpoint_value={})
    a = build_shared_http_request(source_config=src, stream_config=stm, mode="api_test", api_test_checkpoint=None)
    assert r.url == a.url
    assert r.method == a.method
    assert r.params == a.params
    assert r.connector_headers == a.connector_headers
    assert r.stream_headers == a.stream_headers
    assert r.normalized_json_body == a.normalized_json_body


def test_auth_headers_identical_api_test_vs_runtime_merge() -> None:
    """Bearer injection via _apply_auth_to_request must match for plans built both ways."""

    src = {
        "base_url": "https://api.example",
        "auth_type": "BEARER",
        "bearer_token": "secret-token",
        "headers": {"X-Common": "c"},
    }
    stm = {"endpoint": "/r", "method": "GET", "headers": {"X-Stream": "s"}}
    run_plan = build_shared_http_request(source_config=src, stream_config=stm, mode="runtime", checkpoint_value={})
    api_plan = build_shared_http_request(source_config=src, stream_config=stm, mode="api_test", api_test_checkpoint=None)

    auth = _normalize_auth(src)
    for plan in (run_plan, api_plan):
        h = dict(plan.connector_headers)
        h, p = _apply_auth_to_request(auth, h, dict(plan.params), True, None, 30.0, "https://api.example")
        h.update(plan.stream_headers)
        assert h.get("Authorization") == "Bearer secret-token"
        assert p == plan.params


def test_outbound_debug_snapshot_masks_sensitive_headers() -> None:
    req = httpx.Request(
        "GET",
        "https://example.test/path?a=1",
        headers={"Authorization": "Bearer xyz", "X-Custom-Token": "tsec", "Accept": "application/json"},
    )
    resp = httpx.Response(502, request=req, headers={"content-type": "application/json"}, json={"err": True})
    detail = build_outbound_debug_detail(response=resp, body_kwargs={"json": {"q": 1}})
    assert detail["outbound_method"] == "GET"
    assert detail["outbound_url"] == "https://example.test/path"
    assert detail["outbound_query_params"].get("a") == "1"
    oh = detail["outbound_headers_masked"]
    auth_key = "authorization" if "authorization" in oh else "Authorization"
    assert oh.get(auth_key) == "********"
    assert mask_http_headers({"Authorization": "Bearer x"}).get("Authorization") == "********"
    assert detail["body_preview"].startswith("{")
    assert '"q"' in detail["body_preview"]
    assert detail["response_status"] == 502


def test_body_preview_is_json_object_not_encoded_string() -> None:
    stm = {
        "endpoint": "/graphql",
        "method": "GET",
        "body": {"query": "{}", "variables": {"id": 1}},
    }
    src = {"base_url": "https://stellar.example"}
    plan = build_shared_http_request(
        source_config=src,
        stream_config=stm,
        mode="runtime",
        checkpoint_value={},
    )
    bk = httpx_body_kwargs(plan.normalized_json_body, {"Content-Type": "application/json"})
    preview = json.loads(body_preview_for_snapshot(bk))
    assert isinstance(preview, dict)
    assert "query" in preview
