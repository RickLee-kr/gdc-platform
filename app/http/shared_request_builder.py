"""Single place for HTTP outbound request shape: previews, poller, connector probes."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.pollers.http_query_params import (
    drop_placeholder_pagination_params,
    httpx_body_kwargs,
    outbound_body_for_debug,
    unwrap_json_string_body,
)
from app.security.secrets import mask_http_headers, mask_secrets

_CHECKPOINT_VAR_PATTERN = re.compile(r"\{\{\s*checkpoint\.([a-zA-Z0-9_]+)\s*\}\}")


def render_runtime_checkpoint_templates(value: Any, checkpoint: dict[str, Any] | None) -> Any:
    """Replace ``{{checkpoint.field}}`` recursively (runtime poller / run-once)."""

    checkpoint_map = checkpoint or {}

    if isinstance(value, str):

        def _replace(match: re.Match[str]) -> str:
            key = match.group(1)
            replacement = checkpoint_map.get(key)
            return "" if replacement is None else str(replacement)

        return _CHECKPOINT_VAR_PATTERN.sub(_replace, value)

    if isinstance(value, dict):
        return {k: render_runtime_checkpoint_templates(v, checkpoint_map) for k, v in value.items()}
    if isinstance(value, list):
        return [render_runtime_checkpoint_templates(v, checkpoint_map) for v in value]
    return value


def api_test_checkpoint_replacements(checkpoint: dict[str, Any] | None) -> dict[str, str]:
    """Placeholders for onboarding API test / JSON preview (not ``checkpoint.field`` syntax)."""

    now_ms = int(time.time() * 1000)
    window_ms = 86400000
    ck = checkpoint or {}
    ck_val = ck.get("cursor")
    if ck_val is None:
        ck_val = ck.get("value")
    if ck_val is None:
        ck_val = ck.get("last_seen")
    if ck_val is None:
        ck_val = "0"
    return {
        "{{checkpoint}}": str(ck_val),
        "{{start_ms}}": str(now_ms - window_ms),
        "{{end_ms}}": str(now_ms),
    }


def apply_api_test_templates(value: Any, repl: dict[str, str]) -> Any:
    if isinstance(value, str):
        out = value
        for k, v in repl.items():
            out = out.replace(k, v)
        return out
    if isinstance(value, dict):
        return {str(k): apply_api_test_templates(v, repl) for k, v in value.items()}
    if isinstance(value, list):
        return [apply_api_test_templates(v, repl) for v in value]
    return value


def _lookup(cfg: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        if key in cfg and cfg[key] is not None:
            return cfg[key]
    return default


def join_base_url_endpoint(base_url: str, endpoint: str) -> str:
    base = base_url.rstrip("/")
    ep = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    return f"{base}{ep}"


def normalize_http_method(raw: Any, *, default: str = "GET") -> str:
    m = str(raw or default).strip().upper()
    return m if m else default.upper()


def merge_shared_header_layers(*parts: dict[str, Any] | None) -> dict[str, str]:
    """Later layers override earlier keys (connector → stream)."""

    out: dict[str, str] = {}
    for part in parts:
        if not part:
            continue
        for k, v in part.items():
            out[str(k)] = str(v)
    return out


@dataclass(frozen=True)
class SharedHttpRequestPlan:
    """Normalized outbound HTTP resource identity before connector auth is applied."""

    method: str
    endpoint: str
    url: str
    params: dict[str, Any]
    connector_headers: dict[str, str]
    stream_headers: dict[str, str]
    normalized_json_body: Any | None


def build_shared_http_request(
    *,
    source_config: dict[str, Any],
    stream_config: dict[str, Any],
    mode: Literal["runtime", "api_test"],
    checkpoint_value: dict[str, Any] | None = None,
    api_test_checkpoint: dict[str, Any] | None = None,
    invalid_json_body_exc_factory: Any | None = None,
) -> SharedHttpRequestPlan:
    """Build URL, params, header layers, and JSON body used by poller and HTTP API test."""

    base_url = str(_lookup(source_config, ["base_url", "host"], "")).strip()
    endpoint_raw = str(_lookup(stream_config, ["endpoint"], "") or _lookup(stream_config, ["endpoint_path"], "")).strip()
    ep = endpoint_raw if endpoint_raw.startswith("/") else f"/{endpoint_raw}"

    method = normalize_http_method(_lookup(stream_config, ["method"], _lookup(stream_config, ["http_method"], "GET")))

    if mode == "runtime":
        ep_rendered = render_runtime_checkpoint_templates(ep, checkpoint_value)
    else:
        ep_rendered = ep

    request_url = join_base_url_endpoint(base_url, ep_rendered)

    common_src = dict(_lookup(source_config, ["headers", "common_headers"], {}) or {})
    stream_hdr = dict(_lookup(stream_config, ["headers"], {}) or {})
    params_raw = dict(_lookup(stream_config, ["params", "query_params"], {}) or {})
    params_raw = drop_placeholder_pagination_params(stream_config, dict(params_raw))

    if mode == "runtime":
        connector_headers = render_runtime_checkpoint_templates(dict(common_src), checkpoint_value) if common_src else {}
        params = dict(render_runtime_checkpoint_templates(dict(params_raw), checkpoint_value) if params_raw else {})
        repl = None
    else:
        repl = api_test_checkpoint_replacements(api_test_checkpoint)
        connector_headers = {str(k): str(v) for k, v in apply_api_test_templates(dict(common_src), repl).items()} if common_src else {}
        params = dict(apply_api_test_templates(dict(params_raw), repl)) if params_raw else {}

    raw_body = _lookup(stream_config, ["body", "request_body"], None)

    def _raise_bad_json(exc: json.JSONDecodeError) -> None:
        if invalid_json_body_exc_factory is not None:
            invalid_json_body_exc_factory(exc)

    normalized_body: Any | None
    if raw_body is None:
        normalized_body = None
    elif mode == "runtime":
        normalized_body = render_runtime_checkpoint_templates(raw_body, checkpoint_value) if raw_body is not None else None
    else:
        body = raw_body
        repl_eff = repl or {}
        if isinstance(body, str) and body.strip():
            templated = apply_api_test_templates(body.strip(), repl_eff)
            try:
                body = json.loads(templated)
            except json.JSONDecodeError as exc:
                _raise_bad_json(exc)
                raise exc
        elif isinstance(body, dict):
            body = apply_api_test_templates(body, repl_eff)
        elif body is not None:
            body = apply_api_test_templates(body, repl_eff)
        else:
            body = None
        if isinstance(body, str):
            body = unwrap_json_string_body(body)
        normalized_body = body

    stream_headers_rendered: dict[str, str]
    if mode == "runtime":
        stream_headers_rendered = (
            {str(k): str(v) for k, v in render_runtime_checkpoint_templates(dict(stream_hdr), checkpoint_value).items()}
            if stream_hdr
            else {}
        )
    else:
        stream_headers_rendered = (
            {str(k): str(v) for k, v in apply_api_test_templates(dict(stream_hdr), repl or {}).items()} if stream_hdr else {}
        )

    return SharedHttpRequestPlan(
        method=method,
        endpoint=endpoint_raw or ep.lstrip("/"),
        url=request_url,
        params=params,
        connector_headers=connector_headers,
        stream_headers=stream_headers_rendered,
        normalized_json_body=normalized_body,
    )


def body_preview_for_snapshot(body_kwargs: dict[str, Any]) -> str:
    """Short masked preview string aligned with runtime error detail."""

    preview_val = outbound_body_for_debug(body_kwargs) if body_kwargs else None
    if preview_val is None:
        return ""
    try:
        return json.dumps(mask_secrets(preview_val), ensure_ascii=False)[:8000]
    except Exception:
        return str(preview_val)[:8000]


def build_outbound_debug_detail(
    *,
    response: httpx.Response,
    body_kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Stable outbound debug dict for SOURCE_HTTP_ERROR (masks secrets)."""

    req = response.request
    u = httpx.URL(str(req.url))
    try:
        qraw = {str(k): str(v) for k, v in u.params.multi_items()}
    except Exception:
        qraw = {str(k): str(v) for k, v in dict(u.params).items()}
    qdict = mask_secrets(qraw)
    body_preview = body_preview_for_snapshot(body_kwargs)
    full = str(u)
    hdrs = {str(k): str(v) for k, v in req.headers.multi_items()}
    outbound_headers_masked = mask_http_headers(hdrs)

    def _preview_response_body(resp: httpx.Response) -> str:
        try:
            return json.dumps(mask_secrets(resp.json()), ensure_ascii=False)[:8000]
        except Exception:
            raw = resp.text or ""
            return raw[:8000]

    return {
        "error_code": "SOURCE_HTTP_ERROR",
        "outbound_method": req.method,
        "outbound_url": full.split("?")[0],
        "outbound_final_url": full,
        "outbound_query_params": qdict,
        "outbound_headers_masked": outbound_headers_masked,
        "has_json_body": bool(body_kwargs),
        "body_preview": body_preview,
        "response_status": int(response.status_code),
        "response_body": _preview_response_body(response),
    }


__all__ = [
    "SharedHttpRequestPlan",
    "api_test_checkpoint_replacements",
    "apply_api_test_templates",
    "body_preview_for_snapshot",
    "build_outbound_debug_detail",
    "build_shared_http_request",
    "join_base_url_endpoint",
    "merge_shared_header_layers",
    "normalize_http_method",
    "render_runtime_checkpoint_templates",
]
