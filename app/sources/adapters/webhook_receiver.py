"""Webhook receiver source adapter.

The adapter does not perform HTTP handling itself.  The ingest endpoint validates
the request, stores the parsed payload in the runtime source config, and this
adapter hands that payload to the normal StreamRunner extraction stage.
"""

from __future__ import annotations

from typing import Any

from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter

WEBHOOK_PAYLOAD_CONFIG_KEY = "__gdc_webhook_payload"


class WebhookReceiverSourceAdapter(SourceAdapter):
    """Return the already-authenticated inbound webhook payload."""

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        if WEBHOOK_PAYLOAD_CONFIG_KEY not in source_config:
            raise SourceFetchError("Webhook receiver payload missing from runtime context")
        return source_config[WEBHOOK_PAYLOAD_CONFIG_KEY]
