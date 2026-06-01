"""Enrichment engine — static and advanced rule injection after mapping.

Pipeline position: Mapping → **Enrichment** → Formatter → Destination.
"""

from __future__ import annotations

from typing import Any

from app.enrichers.rule_executor import (
    EnrichmentBatchResult,
    EnrichmentExecutionResult,
    execute_enrichment,
    execute_enrichments_batch,
)
from app.runtime.errors import EnrichmentError

_OVERRIDE_KEEP_EXISTING = "KEEP_EXISTING"
_OVERRIDE_FORCE = "OVERRIDE"
_OVERRIDE_ERROR = "ERROR_ON_CONFLICT"

__all__ = [
    "EnrichmentEngine",
    "EnrichmentBatchResult",
    "EnrichmentExecutionResult",
    "apply_enrichment",
    "apply_enrichments",
    "apply_enrichments_batch",
    "_OVERRIDE_KEEP_EXISTING",
    "_OVERRIDE_FORCE",
    "_OVERRIDE_ERROR",
]


def apply_enrichment(
    event: dict[str, Any],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> dict[str, Any]:
    """Merge enrichment (static + advanced rules) into a mapped event.

    Delegates to :mod:`app.enrichers.rule_executor` so preview and runtime share
    identical semantics. ``__rules`` / ``__computed`` are never emitted on the event.

    Raises:
        EnrichmentError: Invalid inputs, policy, static value types, or key conflicts.
    """

    try:
        return execute_enrichment(event, enrichment, override_policy=override_policy).event
    except EnrichmentError:
        raise


def apply_enrichments(
    events: list[dict[str, Any]],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> list[dict[str, Any]]:
    """Apply :func:`apply_enrichment` to each event (batch warnings logged once)."""

    return apply_enrichments_batch(events, enrichment, override_policy=override_policy).events


def apply_enrichments_batch(
    events: list[dict[str, Any]],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> EnrichmentBatchResult:
    """Apply enrichment to events and return batch metadata for observability."""

    try:
        return execute_enrichments_batch(events, enrichment, override_policy=override_policy)
    except EnrichmentError:
        raise


class EnrichmentEngine:
    """Thin façade over enrichment functions."""

    def apply_enrichment(
        self,
        event: dict[str, Any],
        enrichment: dict[str, Any],
        override_policy: str = _OVERRIDE_KEEP_EXISTING,
    ) -> dict[str, Any]:
        """Delegate to :func:`apply_enrichment`."""

        return apply_enrichment(event, enrichment, override_policy=override_policy)

    def apply_enrichments(
        self,
        events: list[dict[str, Any]],
        enrichment: dict[str, Any],
        override_policy: str = _OVERRIDE_KEEP_EXISTING,
    ) -> list[dict[str, Any]]:
        """Delegate to :func:`apply_enrichments`."""

        return apply_enrichments(events, enrichment, override_policy=override_policy)

    def apply_enrichments_batch(
        self,
        events: list[dict[str, Any]],
        enrichment: dict[str, Any],
        override_policy: str = _OVERRIDE_KEEP_EXISTING,
    ) -> EnrichmentBatchResult:
        """Delegate to :func:`apply_enrichments_batch`."""

        return apply_enrichments_batch(events, enrichment, override_policy=override_policy)
