"""Webhook POST delivery."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.json_formatter import format_webhook_events
from app.runtime.errors import DestinationSendError


class WebhookSender:
    """Post event batches to webhook destinations with retry/backoff."""

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
    ) -> None:
        """Send events to webhook endpoint.

        Config supports: url, headers, timeout_seconds, retry_count, retry_backoff_seconds, batch_size.
        formatter_override: Route-level formatter when non-empty (same resolution as syslog).
        """

        if not events:
            return

        try:
            resolve_formatter_config(config, formatter_override)
        except ValueError as exc:
            raise DestinationSendError(str(exc)) from exc

        url = str(config.get("url", "")).strip()
        if not url:
            raise DestinationSendError("Webhook destination requires url")

        headers = dict(config.get("headers", {}))
        timeout_seconds = float(config.get("timeout_seconds", 10))
        retries = int(config.get("retry_count", 2))
        backoff = float(config.get("retry_backoff_seconds", 1.0))
        batch_size = int(config.get("batch_size", len(events) or 1))

        batches: list[list[dict[str, Any]]] = [
            events[i : i + batch_size] for i in range(0, len(events), batch_size)
        ]

        with httpx.Client(timeout=timeout_seconds) as client:
            for batch in batches:
                body = format_webhook_events(batch)
                attempts = retries + 1

                for attempt in range(1, attempts + 1):
                    try:
                        response = client.post(url, headers=headers, json=body)
                        response.raise_for_status()
                        break
                    except httpx.HTTPError as exc:
                        if attempt >= attempts:
                            raise DestinationSendError(
                                f"Webhook send failed after retries: {exc}"
                            ) from exc
                        time.sleep(max(backoff * (2 ** (attempt - 1)), 0))
