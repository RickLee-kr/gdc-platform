"""HTTP stream query params — shared by HttpPoller and API test preview."""

from __future__ import annotations

import json
from typing import Any

_PAGINATION_QUERY_KEYS = frozenset(
    {"cursor", "limit", "page", "offset", "page_size", "per_page", "since", "next", "next_token"}
)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def pagination_disabled(stream_config: dict[str, Any]) -> bool:
    pag = _get(stream_config, "pagination", {}) or {}
    t = str(_get(pag, "type", "") or "").strip().lower()
    return t in {"", "none"}


def value_looks_like_checkpoint_placeholder(val: Any) -> bool:
    if not isinstance(val, str):
        return False
    s = val.strip().lower()
    return "{{" in s and "checkpoint" in s


def drop_placeholder_pagination_params(stream_config: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """When pagination is None/unset, omit query params used only for checkpoint-driven paging."""

    if not pagination_disabled(stream_config):
        return params
    out = dict(params)
    for key in list(out.keys()):
        lk = str(key).lower()
        if lk in _PAGINATION_QUERY_KEYS and value_looks_like_checkpoint_placeholder(out.get(key)):
            del out[key]
    return out


def unwrap_json_string_body(s: str) -> Any:
    """Repeatedly ``json.loads`` while the payload is a JSON-encoded wrapper around more JSON text."""

    cur: Any = s.strip()
    if not cur:
        return ""
    for _ in range(24):
        if not isinstance(cur, str):
            return cur
        try:
            nxt = json.loads(cur)
        except json.JSONDecodeError:
            return cur
        if nxt == cur:
            return cur
        cur = nxt
    return cur


def _content_type_is_json(headers: dict[str, Any] | None) -> bool:
    if not headers:
        return False
    for k, v in headers.items():
        if str(k).lower() == "content-type":
            ct = str(v).lower()
            return "application/json" in ct or ct.endswith("+json")
    return False


def httpx_body_kwargs(body: Any, headers: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build ``httpx`` kwargs for ``json=`` or ``content=`` without double-encoding JSON stored as a string.

    When ``stream_config.body`` is a string holding a JSON object/array, passing it to ``json=`` makes
    httpx emit a JSON *string* value; unwrap with ``json.loads`` first and pass the parsed object.
    """

    if body is None:
        return {}

    if isinstance(body, (dict, list)):
        return {"json": body}

    if isinstance(body, bool):
        return {"json": body}
    if isinstance(body, int):
        return {"json": body}
    if isinstance(body, float):
        return {"json": body}

    if isinstance(body, (bytes, bytearray)):
        return {"content": bytes(body)}

    if isinstance(body, str):
        unwrapped = unwrap_json_string_body(body)
        if isinstance(unwrapped, (dict, list)):
            return {"json": unwrapped}
        if isinstance(unwrapped, str):
            if _content_type_is_json(headers):
                return {"json": unwrapped}
            if not unwrapped:
                return {}
            return {"content": unwrapped.encode("utf-8")}
        return {"json": unwrapped}

    return {"json": body}


def coerce_stream_body_fields_to_json_objects(stream_config: dict[str, Any]) -> dict[str, Any]:
    """If ``body`` / ``request_body`` are JSON text strings, parse to dict/list for runtime.

    Keeps strings that are not valid JSON objects/arrays (e.g. checkpoint templates) unchanged.
    Used when loading stream context so run-once and scheduler see the same shape as HttpPoller sends.
    """

    out = dict(stream_config)
    for key in ("body", "request_body"):
        if key not in out:
            continue
        val = out[key]
        if isinstance(val, str) and val.strip():
            unwrapped = unwrap_json_string_body(val)
            if isinstance(unwrapped, (dict, list)):
                out[key] = unwrapped
    return out


def outbound_body_for_debug(body_kwargs: dict[str, Any]) -> Any:
    """Value to store in outbound debug (same logical payload as sent, for previews)."""

    if "json" in body_kwargs:
        return body_kwargs["json"]
    if "content" in body_kwargs:
        raw = body_kwargs["content"]
        if isinstance(raw, (bytes, bytearray)):
            return raw.decode("utf-8", errors="replace")
        return raw
    return None


__all__ = [
    "coerce_stream_body_fields_to_json_objects",
    "drop_placeholder_pagination_params",
    "httpx_body_kwargs",
    "outbound_body_for_debug",
    "pagination_disabled",
    "unwrap_json_string_body",
    "value_looks_like_checkpoint_placeholder",
]
