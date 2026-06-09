"""AI proxy receiver source adapter.

The ingest endpoint validates the OpenAI-compatible request, stores the normalized
``ai`` envelope in the runtime source config, and this adapter hands it to
StreamRunner extraction unchanged.
"""

from __future__ import annotations

from typing import Any

from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter

AI_PROXY_PAYLOAD_CONFIG_KEY = "__gdc_ai_proxy_payload"


class AiProxyReceiverSourceAdapter(SourceAdapter):
    """Return the already-authenticated inbound AI proxy envelope."""

    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        _ = stream_config, checkpoint
        if AI_PROXY_PAYLOAD_CONFIG_KEY not in source_config:
            raise SourceFetchError("AI proxy receiver payload missing from runtime context")
        return source_config[AI_PROXY_PAYLOAD_CONFIG_KEY]
