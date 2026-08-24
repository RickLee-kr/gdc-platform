"""Queue operational protection / backpressure for PERSISTENT_QUEUE (Phase 5).

Separate from SourceRateLimiter (upstream poll admission). This module only
gates new Source fetch / progression when durable queue pressure exceeds
stream-configured high-water, and auto-releases below low-water.

EXHAUSTED items are never part of pressure depth — they cannot permanently
block processing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Safe defaults when PERSISTENT_QUEUE is on but operator omitted limits.
DEFAULT_MAX_PENDING_ITEMS = 100
DEFAULT_RESUME_RATIO = 0.5


@dataclass(frozen=True, slots=True)
class QueueBackpressureConfig:
    """Minimal backpressure policy (stream.config_json)."""

    max_pending_items: int
    resume_pending_items: int
    max_pending_age_seconds: float | None = None

    def __post_init__(self) -> None:
        if self.max_pending_items < 1:
            object.__setattr__(self, "max_pending_items", 1)
        # low-water must be strictly below high-water when possible
        resume = int(self.resume_pending_items)
        if resume < 0:
            resume = 0
        if resume >= self.max_pending_items:
            resume = max(0, self.max_pending_items - 1)
        object.__setattr__(self, "resume_pending_items", resume)


@dataclass(frozen=True, slots=True)
class QueueOperationalState:
    """Point-in-time durable queue depths (DB-backed)."""

    stream_id: int
    pending_depth: int
    retry_wait_depth: int
    inflight_depth: int
    exhausted_depth: int
    oldest_pending_age_seconds: float | None
    destination_id: int | None = None

    @property
    def pressure_depth(self) -> int:
        """Non-terminal depth used for backpressure (excludes EXHAUSTED)."""

        return int(self.pending_depth) + int(self.retry_wait_depth) + int(self.inflight_depth)

    @property
    def retry_depth(self) -> int:
        """Alias matching architecture / observability naming."""

        return int(self.retry_wait_depth)


@dataclass(frozen=True, slots=True)
class BackpressureDecision:
    """Result of evaluating queue pressure against config + prior active flag."""

    active: bool
    entered: bool
    released: bool
    reason: str | None
    state: QueueOperationalState
    config: QueueBackpressureConfig


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def resolve_backpressure_config(stream: Any) -> QueueBackpressureConfig:
    """Read minimal backpressure knobs from stream config_json / stream_config."""

    stream_config = _get(stream, "stream_config", None)
    if not isinstance(stream_config, dict):
        stream_config = _get(stream, "config_json", None)
    if not isinstance(stream_config, dict):
        stream_config = {}

    nested = stream_config.get("delivery_queue")
    cfg_src = nested if isinstance(nested, dict) else stream_config

    raw_max = cfg_src.get("max_pending_items", stream_config.get("max_pending_items"))
    try:
        max_pending = int(raw_max) if raw_max is not None else DEFAULT_MAX_PENDING_ITEMS
    except (TypeError, ValueError):
        max_pending = DEFAULT_MAX_PENDING_ITEMS
    if max_pending < 1:
        max_pending = DEFAULT_MAX_PENDING_ITEMS

    raw_resume = cfg_src.get(
        "backpressure_resume_items",
        stream_config.get("backpressure_resume_items"),
    )
    if raw_resume is None:
        resume = int(max_pending * DEFAULT_RESUME_RATIO)
    else:
        try:
            resume = int(raw_resume)
        except (TypeError, ValueError):
            resume = int(max_pending * DEFAULT_RESUME_RATIO)

    raw_age = cfg_src.get(
        "max_pending_age_seconds",
        stream_config.get("max_pending_age_seconds"),
    )
    max_age: float | None
    if raw_age is None or raw_age == "":
        max_age = None
    else:
        try:
            max_age = float(raw_age)
            if max_age <= 0:
                max_age = None
        except (TypeError, ValueError):
            max_age = None

    return QueueBackpressureConfig(
        max_pending_items=max_pending,
        resume_pending_items=resume,
        max_pending_age_seconds=max_age,
    )


def evaluate_backpressure(
    state: QueueOperationalState,
    config: QueueBackpressureConfig,
    *,
    previously_active: bool,
) -> BackpressureDecision:
    """High-water enter / low-water release with hysteresis.

    Pressure uses PENDING + IN_FLIGHT + RETRY_WAIT only (never EXHAUSTED).
    """

    depth = int(state.pressure_depth)
    age = state.oldest_pending_age_seconds
    age_over = (
        config.max_pending_age_seconds is not None
        and age is not None
        and float(age) >= float(config.max_pending_age_seconds)
    )
    depth_high = depth >= int(config.max_pending_items)
    depth_low = depth <= int(config.resume_pending_items)

    if depth_high or age_over:
        active = True
        if depth_high and age_over:
            reason = "max_pending_items_and_age"
        elif depth_high:
            reason = "max_pending_items"
        else:
            reason = "max_pending_age"
    elif depth_low and not age_over:
        active = False
        reason = None
    else:
        # Hysteresis band: keep prior state to avoid oscillation.
        active = bool(previously_active)
        reason = "hysteresis_band" if active else None

    entered = bool(active and not previously_active)
    released = bool((not active) and previously_active)
    return BackpressureDecision(
        active=active,
        entered=entered,
        released=released,
        reason=reason if active else ("drained" if released else None),
        state=state,
        config=config,
    )


def backpressure_snapshot_fields(decision: BackpressureDecision) -> dict[str, Any]:
    """Fields suitable for delivery_logs / run summary (minimal ops view)."""

    st = decision.state
    cfg = decision.config
    return {
        "queue_backpressure_active": bool(decision.active),
        "pending_depth": int(st.pending_depth),
        "retry_wait_depth": int(st.retry_wait_depth),
        "retry_depth": int(st.retry_depth),
        "inflight_depth": int(st.inflight_depth),
        "exhausted_depth": int(st.exhausted_depth),
        "pressure_depth": int(st.pressure_depth),
        "oldest_pending_age_seconds": st.oldest_pending_age_seconds,
        "max_pending_items": int(cfg.max_pending_items),
        "backpressure_resume_items": int(cfg.resume_pending_items),
        "max_pending_age_seconds": cfg.max_pending_age_seconds,
        "backpressure_reason": decision.reason,
    }
