"""In-process echo sink for WEBHOOK_POST validation (payload arrival + shape checks)."""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from app.config import settings

_MAX_PER_KEY = 100
_store: dict[str, deque[dict[str, Any]]] = {}
_store_lock = threading.Lock()

router = APIRouter(tags=["validation-echo"])


def _echo_keys() -> tuple[str | None, str | None]:
    """Return (query_key, header_key) expected for echo authentication."""

    return (settings.VALIDATION_ECHO_QUERY_KEY, settings.VALIDATION_ECHO_HEADER_VALUE)


def record_echo(*, key: str, body: Any, headers: dict[str, str]) -> None:
    """Store a receipt (used by tests and in-process diagnostics)."""

    entry = {"body": body, "headers": headers}
    with _store_lock:
        dq = _store.setdefault(key, deque(maxlen=_MAX_PER_KEY))
        dq.append(entry)


def peek_echo_messages(key: str, *, limit: int = 20) -> list[dict[str, Any]]:
    with _store_lock:
        dq = _store.get(key)
        if not dq:
            return []
        return list(dq)[-limit:]


def clear_echo_messages(key: str) -> None:
    with _store_lock:
        _store.pop(key, None)


@router.post("/echo")
async def validation_echo_post(request: Request) -> dict[str, str]:
    """Accept JSON webhook payloads when `key` query matches configured echo secret."""

    expected_q, expected_h = _echo_keys()
    key = request.query_params.get("key") or ""
    header_val = request.headers.get("X-GDC-Validation-Echo-Key", "")
    authorized = False
    if expected_q and key == expected_q:
        authorized = True
    if expected_h and header_val == expected_h:
        authorized = True
    if not authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="echo key mismatch")

    try:
        body: Any = await request.json()
    except Exception:
        body = (await request.body()).decode("utf-8", errors="replace")

    hdrs = {k: v for k, v in request.headers.items() if k.lower().startswith("content")}
    record_echo(key=key or header_val or "default", body=body, headers=hdrs)
    return {"status": "ok"}


@router.get("/echo/recent")
async def validation_echo_recent(request: Request, limit: int = 20) -> dict[str, Any]:
    """Return recent echoed payloads for the authenticated key (operator diagnostics)."""

    expected_q, expected_h = _echo_keys()
    key = request.query_params.get("key") or ""
    header_val = request.headers.get("X-GDC-Validation-Echo-Key", "")
    authorized = False
    if expected_q and key == expected_q:
        authorized = True
    if expected_h and header_val == expected_h:
        authorized = True
    if not authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="echo key mismatch")
    k = key or header_val or "default"
    return {"key": k, "messages": peek_echo_messages(k, limit=min(limit, _MAX_PER_KEY))}


def build_internal_echo_path_with_query() -> str | None:
    """Return path+query for echo when query key is configured (prepend your public API base URL)."""

    q, _h = _echo_keys()
    if not q:
        return None
    base = str(settings.API_PREFIX).rstrip("/")
    return f"{base}/validation/echo?key={q}"
