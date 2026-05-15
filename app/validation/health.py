"""Derive validation health from recent outcomes (separate from runtime health scoring)."""

from __future__ import annotations

from typing import Literal

from app.validation.schemas import RunRowStatus

ValidationHealthStatus = Literal["HEALTHY", "DEGRADED", "FAILING", "DISABLED"]


def compute_health_status(
    *,
    enabled: bool,
    overall_status: RunRowStatus,
    consecutive_failures: int,
    had_auth_failure: bool,
    had_checkpoint_drift: bool,
) -> ValidationHealthStatus:
    """Weighted severity: auth and checkpoint issues escalate faster."""

    if not enabled:
        return "DISABLED"
    if overall_status == "PASS":
        return "HEALTHY"

    effective = int(consecutive_failures)
    if had_auth_failure:
        effective += 2
    if had_checkpoint_drift:
        effective += 2

    if effective >= 5:
        return "FAILING"
    if effective >= 2:
        return "DEGRADED"
    return "DEGRADED"


def next_consecutive_failures(current: int, overall_status: RunRowStatus) -> int:
    if overall_status == "PASS":
        return 0
    if overall_status == "WARN":
        return current
    return current + 1
