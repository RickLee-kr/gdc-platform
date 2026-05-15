"""Shared HTTP helpers for connector auth strategies (runtime + preview)."""

from __future__ import annotations

from typing import Any


def build_request_url(base_url: str, endpoint: str) -> str:
    base = base_url.rstrip("/")
    ep = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    return f"{base}{ep}"


def extract_json_path_value(payload: Any, json_path: str) -> Any:
    path = (json_path or "").strip()
    if not path.startswith("$."):
        return None
    current = payload
    for part in path[2:].split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def build_token_value(prefix: str | None, token: str) -> str:
    pref = str(prefix or "").strip()
    return f"{pref} {token}".strip() if pref else token
