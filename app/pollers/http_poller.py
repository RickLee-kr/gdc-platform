"""HTTP API polling — fetch raw responses for StreamRunner."""

from __future__ import annotations

import re
import time
from copy import deepcopy
from typing import Any

import httpx

from app.runtime.errors import SourceFetchError

_CHECKPOINT_PATTERN = re.compile(r"\{\{\s*checkpoint\.([a-zA-Z0-9_]+)\s*\}\}")


def _get(data: Any, key: str, default: Any = None) -> Any:
    """Read key from dict/object."""

    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def _render_checkpoint_templates(value: Any, checkpoint: dict[str, Any] | None) -> Any:
    """Recursively render ``{{checkpoint.xxx}}`` templates."""

    checkpoint_map = checkpoint or {}

    if isinstance(value, str):
        def _replace(match: re.Match[str]) -> str:
            key = match.group(1)
            replacement = checkpoint_map.get(key)
            return "" if replacement is None else str(replacement)

        return _CHECKPOINT_PATTERN.sub(_replace, value)

    if isinstance(value, dict):
        return {k: _render_checkpoint_templates(v, checkpoint_map) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_checkpoint_templates(v, checkpoint_map) for v in value]
    return value


class HttpPoller:
    """HTTP poller with retry/backoff and basic 429 handling."""

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        """Fetch JSON payload for one stream cycle.

        Supports GET/POST, timeout, retry, backoff, and Retry-After for 429.
        """

        base_url = str(_get(source_config, "base_url", "")).rstrip("/")
        endpoint = str(_get(stream_config, "endpoint", ""))
        method = str(_get(stream_config, "method", "GET")).upper()

        if not base_url:
            raise SourceFetchError("HTTP source_config.base_url is required")
        if not endpoint:
            raise SourceFetchError("HTTP stream_config.endpoint is required")
        if method not in {"GET", "POST"}:
            raise SourceFetchError(f"Unsupported HTTP method: {method}")

        timeout_seconds = float(_get(stream_config, "timeout_seconds", _get(source_config, "timeout_seconds", 30)))
        retries = int(_get(stream_config, "retry_count", _get(source_config, "retry_count", 2)))
        initial_backoff = float(_get(stream_config, "retry_backoff_seconds", 1.0))

        raw_headers = deepcopy(_get(stream_config, "headers", {}))
        raw_params = deepcopy(_get(stream_config, "params", {}))
        raw_body = deepcopy(_get(stream_config, "body", None))

        auth_type = str(_get(source_config, "auth_type", "")).lower()
        token = _get(source_config, "token")
        if auth_type == "bearer_token" and token:
            raw_headers = dict(raw_headers or {})
            raw_headers.setdefault("Authorization", f"Bearer {token}")

        url = f"{base_url}{_render_checkpoint_templates(endpoint, checkpoint)}"
        headers = _render_checkpoint_templates(raw_headers, checkpoint) if raw_headers else {}
        params = _render_checkpoint_templates(raw_params, checkpoint) if raw_params else None
        json_body = _render_checkpoint_templates(raw_body, checkpoint) if raw_body is not None else None

        attempts = retries + 1
        last_error: Exception | None = None

        with httpx.Client(timeout=timeout_seconds) as client:
            for attempt in range(1, attempts + 1):
                try:
                    response = client.request(
                        method=method,
                        url=url,
                        headers=headers,
                        params=params,
                        json=json_body if method == "POST" else None,
                    )

                    if response.status_code == 429:
                        retry_after = response.headers.get("Retry-After")
                        sleep_seconds = float(retry_after) if retry_after else initial_backoff * (2 ** (attempt - 1))
                        if attempt < attempts:
                            time.sleep(max(sleep_seconds, 0))
                            continue
                        raise SourceFetchError("HTTP 429 exceeded retries")

                    response.raise_for_status()
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise SourceFetchError("HTTP response is not valid JSON") from exc

                except (httpx.HTTPError, SourceFetchError) as exc:
                    last_error = exc
                    if attempt >= attempts:
                        break
                    time.sleep(max(initial_backoff * (2 ** (attempt - 1)), 0))

        raise SourceFetchError(f"HTTP polling failed after retries: {last_error}")


class HTTPPoller(HttpPoller):
    """Backward-compatible class name alias."""
