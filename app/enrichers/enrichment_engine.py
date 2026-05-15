"""Enrichment engine — static field injection after mapping.

Pipeline position: Mapping → **Enrichment** → Formatter → Destination.
"""

from __future__ import annotations

import copy
from typing import Any

from app.runtime.errors import EnrichmentError

_OVERRIDE_KEEP_EXISTING = "KEEP_EXISTING"
_OVERRIDE_FORCE = "OVERRIDE"
_OVERRIDE_ERROR = "ERROR_ON_CONFLICT"

_ALLOWED_POLICIES = frozenset({_OVERRIDE_KEEP_EXISTING, _OVERRIDE_FORCE, _OVERRIDE_ERROR})


def _json_like_value(value: Any) -> bool:
    """Return True if ``value`` uses only allowed JSON-like scalars/containers."""

    if value is None or isinstance(value, bool | int | float | str):
        return True
    if isinstance(value, dict):
        return all(isinstance(k, str) and _json_like_value(v) for k, v in value.items())
    if isinstance(value, list):
        return all(_json_like_value(item) for item in value)
    return False


def _validate_policy(policy: str) -> str:
    if policy not in _ALLOWED_POLICIES:
        raise EnrichmentError(
            f"Unknown override_policy {policy!r}; "
            f"expected one of {sorted(_ALLOWED_POLICIES)}"
        )
    return policy


def apply_enrichment(
    event: dict[str, Any],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> dict[str, Any]:
    """Merge static enrichment fields into a mapped event.

    Args:
        event: Mapped event (never mutated in-place).
        enrichment: Keys/values to add. Values must be JSON-like scalars or nested
            dict/list structures composed of those types. Callables are rejected.
        override_policy:
            - ``KEEP_EXISTING``: do not replace keys already present on ``event``.
            - ``OVERRIDE``: replace existing keys with enrichment values.
            - ``ERROR_ON_CONFLICT``: raise if an enrichment key exists on ``event``.

    Raises:
        EnrichmentError: Invalid inputs, policy, value types, or key conflicts.
    """

    policy = _validate_policy(override_policy)

    if not isinstance(event, dict):
        raise EnrichmentError(f"apply_enrichment expects dict event, got {type(event).__name__}")

    if not enrichment:
        return copy.deepcopy(event)

    base = copy.deepcopy(event)

    for key, value in enrichment.items():
        if not isinstance(key, str):
            raise EnrichmentError(f"Enrichment keys must be str, got {type(key).__name__}")
        if not _json_like_value(value):
            raise EnrichmentError(
                f"Enrichment value for field {key!r} must be str/int/float/bool/None/"
                f"dict/list (JSON-like); got {type(value).__name__}"
            )

        if key in base:
            if policy == _OVERRIDE_KEEP_EXISTING:
                continue
            if policy == _OVERRIDE_ERROR:
                raise EnrichmentError(
                    f"Enrichment field {key!r} conflicts with existing event field "
                    f"(override_policy={policy})"
                )
            base[key] = copy.deepcopy(value)
        else:
            base[key] = copy.deepcopy(value)

    return base


def apply_enrichments(
    events: list[dict[str, Any]],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> list[dict[str, Any]]:
    """Apply :func:`apply_enrichment` to each event."""

    return [apply_enrichment(ev, enrichment, override_policy=override_policy) for ev in events]


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
