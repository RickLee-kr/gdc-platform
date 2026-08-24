"""Destination-scoped adaptive concurrency (AIMD).

Separate from:
- Destination Rate Limiter (request volume / time windows)
- HTTP Resilience (per-request retry / Retry-After)
- Circuit Breaker (prolonged outage suppression)
- Queue Backpressure (source progression under queue pressure)

Controls how many Destination network I/O operations may run concurrently per
``destination_id``. State is process-local; restart resets to configured
``min_concurrency`` (safe default). No DB persistence in this phase.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from enum import Enum
from typing import Any

DEFAULT_MIN_CONCURRENCY = 1
DEFAULT_MAX_CONCURRENCY = 4
# Internal AIMD constants (not destination config — keep operator surface minimal).
_INCREASE_AFTER_HEALTHY = 3
_LATENCY_SPIKE_RATIO = 2.0
_EWMA_ALPHA = 0.3


class ConcurrencySignal(str, Enum):
    """Outcome signal used to adjust the concurrency limit."""

    SUCCESS = "success"
    TIMEOUT = "timeout"
    TRANSIENT_FAILURE = "transient_failure"
    RATE_LIMIT_429 = "rate_limit_429"
    LATENCY_SPIKE = "latency_spike"


class ConcurrencyAdjustReason(str, Enum):
    HEALTHY_INCREASE = "healthy_increase"
    LATENCY_SPIKE = "latency_spike"
    TIMEOUT = "timeout"
    TRANSIENT_FAILURE = "transient_failure"
    RATE_LIMIT_429 = "rate_limit_429"


@dataclass(frozen=True, slots=True)
class AdaptiveConcurrencyConfig:
    """``destination.config_json.adaptive_concurrency`` (minimal)."""

    enabled: bool = False
    min_concurrency: int = DEFAULT_MIN_CONCURRENCY
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY

    def __post_init__(self) -> None:
        lo = max(1, int(self.min_concurrency))
        hi = max(lo, int(self.max_concurrency))
        object.__setattr__(self, "min_concurrency", lo)
        object.__setattr__(self, "max_concurrency", hi)


@dataclass(frozen=True, slots=True)
class ConcurrencyAcquireResult:
    granted: bool
    current_limit: int
    active: int
    disabled: bool = False
    limited: bool = False


@dataclass(frozen=True, slots=True)
class ConcurrencyAdjustment:
    """Emitted when the limit changes (or when an acquire is refused)."""

    event: str  # concurrency_increased | concurrency_decreased | concurrency_limited
    destination_id: int
    old_limit: int
    new_limit: int
    reason: str
    active: int


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


def resolve_adaptive_concurrency_config(destination_or_config: Any) -> AdaptiveConcurrencyConfig:
    """Read adaptive concurrency knobs from destination config."""

    cfg = destination_or_config
    if not isinstance(cfg, dict) or "adaptive_concurrency" not in cfg:
        nested_cfg = _get(destination_or_config, "config", None)
        if not isinstance(nested_cfg, dict):
            nested_cfg = _get(destination_or_config, "config_json", None)
        if isinstance(nested_cfg, dict):
            cfg = nested_cfg
        elif not isinstance(cfg, dict):
            cfg = {}

    nested = cfg.get("adaptive_concurrency") if isinstance(cfg, dict) else None
    src = nested if isinstance(nested, dict) else {}

    raw_enabled = src.get("enabled", False)
    if isinstance(raw_enabled, str):
        enabled = raw_enabled.strip().lower() in {"1", "true", "yes", "on"}
    else:
        enabled = bool(raw_enabled)

    try:
        min_c = int(src.get("min_concurrency", DEFAULT_MIN_CONCURRENCY))
    except (TypeError, ValueError):
        min_c = DEFAULT_MIN_CONCURRENCY
    try:
        max_c = int(src.get("max_concurrency", DEFAULT_MAX_CONCURRENCY))
    except (TypeError, ValueError):
        max_c = DEFAULT_MAX_CONCURRENCY
    return AdaptiveConcurrencyConfig(
        enabled=enabled,
        min_concurrency=min_c,
        max_concurrency=max_c,
    )


def classify_concurrency_signal(
    *,
    success: bool,
    latency_ms: int | None = None,
    error: BaseException | None = None,
    ewma_latency_ms: float | None = None,
) -> ConcurrencySignal:
    """Map send outcome → adaptive signal (reuses HTTP Resilience classification)."""

    if success:
        if (
            latency_ms is not None
            and ewma_latency_ms is not None
            and ewma_latency_ms > 0
            and float(latency_ms) > float(ewma_latency_ms) * _LATENCY_SPIKE_RATIO
        ):
            return ConcurrencySignal.LATENCY_SPIKE
        return ConcurrencySignal.SUCCESS

    if error is None:
        return ConcurrencySignal.TRANSIENT_FAILURE

    from app.delivery_queue.outcome import classify_destination_send_error
    from app.http.resilience import HttpOutcome

    classified = classify_destination_send_error(error)
    if classified.outcome == HttpOutcome.RATE_LIMIT:
        return ConcurrencySignal.RATE_LIMIT_429
    if classified.reason == "timeout" or classified.status_code == 408:
        return ConcurrencySignal.TIMEOUT
    if classified.outcome == HttpOutcome.RETRY:
        return ConcurrencySignal.TRANSIENT_FAILURE
    # FATAL / unknown client errors do not drive AIMD decreases.
    return ConcurrencySignal.SUCCESS


@dataclass
class _DestinationConcurrency:
    limit: int
    active: int = 0
    healthy_streak: int = 0
    ewma_latency_ms: float | None = None


class DestinationAdaptiveConcurrency:
    """Process-local AIMD concurrency controller keyed by ``destination_id``."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._by_destination: dict[int, _DestinationConcurrency] = {}

    def reset(self) -> None:
        with self._lock:
            self._by_destination.clear()

    def get_limit(self, destination_id: int, config: AdaptiveConcurrencyConfig | None = None) -> int:
        cfg = config or AdaptiveConcurrencyConfig()
        with self._lock:
            entry = self._by_destination.get(int(destination_id))
            if entry is None:
                return int(cfg.min_concurrency) if cfg.enabled else 0
            return int(entry.limit)

    def get_active(self, destination_id: int) -> int:
        with self._lock:
            entry = self._by_destination.get(int(destination_id))
            return int(entry.active) if entry is not None else 0

    def get_ewma_latency_ms(self, destination_id: int) -> float | None:
        with self._lock:
            entry = self._by_destination.get(int(destination_id))
            if entry is None or entry.ewma_latency_ms is None:
                return None
            return float(entry.ewma_latency_ms)

    def _entry(self, destination_id: int, cfg: AdaptiveConcurrencyConfig) -> _DestinationConcurrency:
        key = int(destination_id)
        entry = self._by_destination.get(key)
        if entry is None:
            entry = _DestinationConcurrency(limit=int(cfg.min_concurrency))
            self._by_destination[key] = entry
        entry.limit = min(max(int(entry.limit), int(cfg.min_concurrency)), int(cfg.max_concurrency))
        return entry

    def try_acquire(
        self,
        destination_id: int,
        config: AdaptiveConcurrencyConfig | None = None,
    ) -> tuple[ConcurrencyAcquireResult, ConcurrencyAdjustment | None]:
        """Non-blocking acquire of one Destination I/O slot.

        When disabled, always grants without tracking (preserves baseline behavior).
        When limited, returns ``granted=False`` and a ``concurrency_limited`` event —
        callers must not claim durable-queue items into IN_FLIGHT while waiting.
        """

        cfg = config or AdaptiveConcurrencyConfig()
        if not cfg.enabled:
            return (
                ConcurrencyAcquireResult(
                    granted=True,
                    current_limit=0,
                    active=0,
                    disabled=True,
                ),
                None,
            )

        with self._lock:
            entry = self._entry(destination_id, cfg)
            if entry.active >= entry.limit:
                adj = ConcurrencyAdjustment(
                    event="concurrency_limited",
                    destination_id=int(destination_id),
                    old_limit=int(entry.limit),
                    new_limit=int(entry.limit),
                    reason="active_at_limit",
                    active=int(entry.active),
                )
                return (
                    ConcurrencyAcquireResult(
                        granted=False,
                        current_limit=int(entry.limit),
                        active=int(entry.active),
                        limited=True,
                    ),
                    adj,
                )
            entry.active += 1
            return (
                ConcurrencyAcquireResult(
                    granted=True,
                    current_limit=int(entry.limit),
                    active=int(entry.active),
                ),
                None,
            )

    def release(
        self,
        destination_id: int,
        config: AdaptiveConcurrencyConfig | None = None,
        *,
        signal: ConcurrencySignal = ConcurrencySignal.SUCCESS,
        latency_ms: int | None = None,
        circuit_open: bool = False,
        acquired: bool = True,
        disabled: bool = False,
        adjust: bool = True,
    ) -> ConcurrencyAdjustment | None:
        """Release a previously acquired slot and optionally apply AIMD."""

        if disabled or not acquired:
            return None
        cfg = config or AdaptiveConcurrencyConfig()
        if not cfg.enabled:
            return None

        with self._lock:
            entry = self._entry(destination_id, cfg)
            if entry.active > 0:
                entry.active -= 1
            if not adjust:
                return None
            return self._adjust_locked(
                destination_id=int(destination_id),
                entry=entry,
                cfg=cfg,
                signal=signal,
                latency_ms=latency_ms,
                circuit_open=circuit_open,
            )

    def record_signal(
        self,
        destination_id: int,
        config: AdaptiveConcurrencyConfig | None = None,
        *,
        signal: ConcurrencySignal | None = None,
        success: bool = True,
        latency_ms: int | None = None,
        error: BaseException | None = None,
        circuit_open: bool = False,
    ) -> ConcurrencyAdjustment | None:
        """Classify (optional) and apply AIMD without changing ``active``."""

        cfg = config or AdaptiveConcurrencyConfig()
        if not cfg.enabled:
            return None
        with self._lock:
            entry = self._entry(destination_id, cfg)
            resolved = signal
            if resolved is None:
                resolved = classify_concurrency_signal(
                    success=success,
                    latency_ms=latency_ms,
                    error=error,
                    ewma_latency_ms=entry.ewma_latency_ms,
                )
            return self._adjust_locked(
                destination_id=int(destination_id),
                entry=entry,
                cfg=cfg,
                signal=resolved,
                latency_ms=latency_ms,
                circuit_open=circuit_open,
            )

    def _adjust_locked(
        self,
        *,
        destination_id: int,
        entry: _DestinationConcurrency,
        cfg: AdaptiveConcurrencyConfig,
        signal: ConcurrencySignal,
        latency_ms: int | None,
        circuit_open: bool,
    ) -> ConcurrencyAdjustment | None:
        old = int(entry.limit)

        # Fold successful latency into EWMA after spike classification (caller
        # should classify against the prior EWMA via classify_concurrency_signal).
        if signal in {ConcurrencySignal.SUCCESS, ConcurrencySignal.LATENCY_SPIKE} and latency_ms is not None:
            sample = float(latency_ms)
            if entry.ewma_latency_ms is None:
                entry.ewma_latency_ms = sample
            else:
                entry.ewma_latency_ms = (
                    _EWMA_ALPHA * sample + (1.0 - _EWMA_ALPHA) * float(entry.ewma_latency_ms)
                )

        if signal in {
            ConcurrencySignal.TIMEOUT,
            ConcurrencySignal.TRANSIENT_FAILURE,
            ConcurrencySignal.LATENCY_SPIKE,
            ConcurrencySignal.RATE_LIMIT_429,
        }:
            entry.healthy_streak = 0
            if signal == ConcurrencySignal.RATE_LIMIT_429:
                new_limit = int(cfg.min_concurrency)
                reason = ConcurrencyAdjustReason.RATE_LIMIT_429.value
            elif signal == ConcurrencySignal.TIMEOUT:
                new_limit = max(int(cfg.min_concurrency), old // 2)
                reason = ConcurrencyAdjustReason.TIMEOUT.value
            elif signal == ConcurrencySignal.LATENCY_SPIKE:
                new_limit = max(int(cfg.min_concurrency), old // 2)
                reason = ConcurrencyAdjustReason.LATENCY_SPIKE.value
            else:
                new_limit = max(int(cfg.min_concurrency), old // 2)
                reason = ConcurrencyAdjustReason.TRANSIENT_FAILURE.value
            if new_limit == old:
                return None
            entry.limit = new_limit
            return ConcurrencyAdjustment(
                event="concurrency_decreased",
                destination_id=destination_id,
                old_limit=old,
                new_limit=new_limit,
                reason=reason,
                active=int(entry.active),
            )

        # SUCCESS — additive increase when healthy and circuit not OPEN.
        if circuit_open:
            entry.healthy_streak = 0
            return None

        entry.healthy_streak += 1
        if entry.healthy_streak < _INCREASE_AFTER_HEALTHY:
            return None
        entry.healthy_streak = 0
        if old >= int(cfg.max_concurrency):
            return None
        new_limit = min(int(cfg.max_concurrency), old + 1)
        if new_limit == old:
            return None
        entry.limit = new_limit
        return ConcurrencyAdjustment(
            event="concurrency_increased",
            destination_id=destination_id,
            old_limit=old,
            new_limit=new_limit,
            reason=ConcurrencyAdjustReason.HEALTHY_INCREASE.value,
            active=int(entry.active),
        )

    def force_limit_for_tests(self, destination_id: int, limit: int, *, active: int = 0) -> None:
        with self._lock:
            self._by_destination[int(destination_id)] = _DestinationConcurrency(
                limit=max(1, int(limit)),
                active=max(0, int(active)),
            )
