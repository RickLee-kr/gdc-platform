"""Runtime failure/lifecycle evidence on the existing DeliveryLog path.

Maps conceptual observability events to ``delivery_logs.stage`` tokens.
Does not introduce a parallel telemetry engine.
"""

from __future__ import annotations

from typing import Any

# Conceptual evidence → persisted stage (reuse existing tokens where they already exist).
EVIDENCE_STAGE = {
    "source_fetch_started": "source_fetch_started",
    "source_fetch_succeeded": "source_fetch",
    "source_fetch_failed": "source_fetch_failed",
    "delivery_attempt": "delivery_attempt",
    "delivery_succeeded": "route_send_success",
    "delivery_failed": "route_send_failed",
    "retry_scheduled": "retry_scheduled",
    "recovery_success": "recovery_success",
    "checkpoint_held": "checkpoint_held",
    "checkpoint_advanced": "checkpoint_update",
    "queue_enqueued": "queue_enqueued",
    "queue_claimed": "queue_claimed",
    "queue_retry_wait": "queue_retry_wait",
    "queue_delivered": "queue_delivered",
    "queue_exhausted": "queue_exhausted",
    "queue_recovery_started": "queue_recovery_started",
    "stale_inflight_recovered": "stale_inflight_recovered",
    "queue_recovery_claimed": "queue_recovery_claimed",
    "recovery_failure": "recovery_failure",
    "queue_backpressure_entered": "queue_backpressure_entered",
    "queue_backpressure_active": "queue_backpressure_active",
    "queue_backpressure_released": "queue_backpressure_released",
    "circuit_opened": "circuit_opened",
    "circuit_request_blocked": "circuit_request_blocked",
    "circuit_half_open": "circuit_half_open",
    "circuit_probe_success": "circuit_probe_success",
    "circuit_probe_failed": "circuit_probe_failed",
    "circuit_closed": "circuit_closed",
}

# Stages written immediately via an isolated session so later rollbacks cannot erase them.
DURABLE_LIFECYCLE_STAGES: frozenset[str] = frozenset(
    {
        "run_started",
        "source_fetch_started",
        "source_fetch_failed",
        "checkpoint_held",
        "run_failed",
    }
)

# New + existing StreamRunner allowlist additions for lifecycle evidence.
RUNTIME_EVIDENCE_STAGES: frozenset[str] = frozenset(
    {
        "source_fetch_started",
        "source_fetch_failed",
        "delivery_attempt",
        "retry_scheduled",
        "recovery_success",
        "checkpoint_held",
        "run_failed",
        "queue_enqueued",
        "queue_claimed",
        "queue_retry_wait",
        "queue_delivered",
        "queue_exhausted",
        "queue_recovery_started",
        "stale_inflight_recovered",
        "queue_recovery_claimed",
        "recovery_failure",
        "queue_backpressure_entered",
        "queue_backpressure_active",
        "queue_backpressure_released",
        "circuit_opened",
        "circuit_request_blocked",
        "circuit_half_open",
        "circuit_probe_success",
        "circuit_probe_failed",
        "circuit_closed",
    }
)

CORRELATION_KEYS: tuple[str, ...] = (
    "run_id",
    "stream_id",
    "route_id",
    "destination_id",
    "attempt",
)


def correlation_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Extract correlation identifiers present on a log payload or DeliveryLog row dict."""

    out: dict[str, Any] = {}
    for key in CORRELATION_KEYS:
        if key not in payload or payload[key] is None:
            continue
        val = payload[key]
        if key in {"stream_id", "route_id", "destination_id", "attempt"}:
            try:
                out[key] = int(val)
            except (TypeError, ValueError):
                out[key] = val
        else:
            out[key] = str(val)
    return out


def lifecycle_stage_set(stages: set[str] | frozenset[str] | list[str]) -> set[str]:
    """Normalize a collection of stage tokens."""

    return {str(s).strip() for s in stages if str(s).strip()}


def has_evidence(stages: set[str] | frozenset[str] | list[str], conceptual: str) -> bool:
    """True when ``stages`` includes the persisted token for a conceptual evidence name."""

    token = EVIDENCE_STAGE.get(conceptual, conceptual)
    return token in lifecycle_stage_set(stages)
