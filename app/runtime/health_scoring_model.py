"""Canonical operational health scoring modes and recovery/decay semantics.

Two explicit models (do not mix silently):

CURRENT_RUNTIME_STATE (``current_runtime``)
    Reflects latest operational posture. Scoring uses a **recent posture window**
    inside the requested analytics window, plus recovery when ``last_success_at`` is
    at or after ``last_failure_at``. Old failures decay; sustained success restores
    HEALTHY.

HISTORICAL_ANALYTICS (``historical_analytics``)
    Full-window delivery_log aggregates for trend / long-term scoring. Preserves
    historical failure counts and rates for Analytics surfaces.

Canonical levels (score 0..100):

- HEALTHY (>= 90): recent successful execution; low live failure ratio.
- DEGRADED (70..89): intermittent failures but mostly successful recently.
- UNHEALTHY (40..69): sustained failures with partial recovery.
- CRITICAL (< 40): repeated recent failures with little or no recent success.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.runtime.health_schemas import HealthFactor, HealthLevel, HealthMetrics, HealthScore

ScoringMode = Literal["current_runtime", "historical_analytics"]

LEVEL_HEALTHY: HealthLevel = "HEALTHY"
LEVEL_DEGRADED: HealthLevel = "DEGRADED"
LEVEL_UNHEALTHY: HealthLevel = "UNHEALTHY"
LEVEL_CRITICAL: HealthLevel = "CRITICAL"

# Recent posture slice inside the resolved window (live scoring input).
_RECENT_MIN = timedelta(minutes=15)
_RECENT_MAX = timedelta(hours=1)
_RECENT_FRACTION = 0.25

# Exponential decay half-life for stale failures after recovery (~2h).
_FAILURE_DECAY_LAMBDA_PER_HOUR = 0.35

# Recovery floor when posture has turned healthy (success after last failure).
_RECOVERY_HEALTHY_FLOOR = 92
_RECOVERY_DEGRADED_FLOOR = 75

UTC = timezone.utc


@dataclass(frozen=True)
class OutcomeAggregate:
    failure_count: int
    success_count: int
    retry_event_count: int
    retry_count_sum: int
    rate_limit_count: int
    latency_ms_avg: float | None
    latency_ms_p95: float | None
    last_failure_at: datetime | None
    last_success_at: datetime | None


def resolve_recent_posture_window(
    since: datetime, until: datetime
) -> tuple[datetime, datetime]:
    """Return (recent_since, until) for CURRENT_RUNTIME_STATE scoring."""

    span = until - since
    if span <= _RECENT_MIN:
        return since, until
    target = span * _RECENT_FRACTION
    recent_span = min(max(target, _RECENT_MIN), _RECENT_MAX, span)
    return until - recent_span, until


def _ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 6)


def _score_to_level(score: int) -> HealthLevel:
    if score >= 90:
        return LEVEL_HEALTHY
    if score >= 70:
        return LEVEL_DEGRADED
    if score >= 40:
        return LEVEL_UNHEALTHY
    return LEVEL_CRITICAL


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def failure_decay_multiplier(
    agg: OutcomeAggregate,
    *,
    now: datetime,
) -> float:
    """How much full-window failure volume still penalizes score (0..1).

    After recovery (success at or after last failure), older failures decay
    exponentially with time since the latest success.
    """

    if agg.failure_count <= 0:
        return 0.0
    last_fail = _ensure_utc(agg.last_failure_at)
    last_ok = _ensure_utc(agg.last_success_at)
    if last_ok is None:
        return 1.0
    if last_fail is None or last_ok >= last_fail:
        hours = max(0.0, (now - last_ok).total_seconds() / 3600.0)
        return math.exp(-_FAILURE_DECAY_LAMBDA_PER_HOUR * hours)
    return 1.0


def recent_success_ratio(agg: OutcomeAggregate) -> float:
    return _ratio(agg.success_count, agg.failure_count + agg.success_count)


def health_recovery_score(agg_full: OutcomeAggregate, agg_recent: OutcomeAggregate) -> float:
    """0..1 recovery signal: recent success ratio blended with recency of success."""

    recent = recent_success_ratio(agg_recent)
    last_fail = _ensure_utc(agg_full.last_failure_at)
    last_ok = _ensure_utc(agg_full.last_success_at)
    if last_ok is None:
        return round(recent * 0.5, 6)
    if last_fail is None or last_ok >= last_fail:
        return round(min(1.0, recent + 0.25), 6)
    return round(recent * 0.35, 6)


def is_recovered_posture(agg_full: OutcomeAggregate) -> bool:
    last_fail = _ensure_utc(agg_full.last_failure_at)
    last_ok = _ensure_utc(agg_full.last_success_at)
    if last_ok is None:
        return False
    if last_fail is None:
        return True
    return last_ok >= last_fail


def build_health_metrics(
    agg_scoring: OutcomeAggregate,
    agg_full: OutcomeAggregate,
    agg_recent: OutcomeAggregate,
    *,
    scoring_mode: ScoringMode,
    recent_window_since: datetime | None = None,
    recent_window_until: datetime | None = None,
) -> HealthMetrics:
    tot_full = agg_full.failure_count + agg_full.success_count
    tot_recent = agg_recent.failure_count + agg_recent.success_count
    recent_fr = _ratio(agg_recent.failure_count, tot_recent)
    if scoring_mode == "current_runtime":
        display = agg_recent
        display_tot = tot_recent
    else:
        display = agg_full
        display_tot = tot_full
    return HealthMetrics(
        failure_count=display.failure_count,
        success_count=display.success_count,
        retry_event_count=display.retry_event_count,
        retry_count_sum=display.retry_count_sum,
        failure_rate=_ratio(display.failure_count, display_tot),
        retry_rate=_ratio(
            display.retry_event_count,
            display.failure_count + display.success_count,
        ),
        latency_ms_avg=display.latency_ms_avg,
        latency_ms_p95=display.latency_ms_p95,
        last_failure_at=display.last_failure_at,
        last_success_at=display.last_success_at,
        historical_failure_count=agg_full.failure_count,
        historical_delivery_failure_rate=_ratio(agg_full.failure_count, tot_full),
        live_delivery_failure_rate=recent_fr,
        recent_success_ratio=recent_success_ratio(agg_recent),
        health_recovery_score=health_recovery_score(agg_full, agg_recent),
        recent_failure_count=agg_recent.failure_count,
        recent_success_count=agg_recent.success_count,
        recent_failure_rate=recent_fr,
        recent_window_since=recent_window_since,
        recent_window_until=recent_window_until,
        current_runtime_health=None,
    )


def _recent_posture_recovered(agg_recent: OutcomeAggregate) -> bool:
    """True when the latest outcome in the recent slice is success (or no failures)."""

    if agg_recent.failure_count == 0:
        return True
    last_fail = _ensure_utc(agg_recent.last_failure_at)
    last_ok = _ensure_utc(agg_recent.last_success_at)
    if last_ok is None:
        return False
    if last_fail is None:
        return True
    return last_ok >= last_fail


def live_scoring_aggregate(
    agg_full: OutcomeAggregate,
    agg_recent: OutcomeAggregate,
) -> OutcomeAggregate:
    """Aggregate used for current_runtime factor penalties (post-recovery aware)."""

    if not is_recovered_posture(agg_full):
        return agg_recent
    recent_n = agg_recent.failure_count + agg_recent.success_count
    if recent_n == 0:
        return OutcomeAggregate(
            failure_count=0,
            success_count=max(agg_full.success_count, 1),
            retry_event_count=0,
            retry_count_sum=0,
            rate_limit_count=0,
            latency_ms_avg=agg_recent.latency_ms_avg,
            latency_ms_p95=agg_recent.latency_ms_p95,
            last_failure_at=agg_full.last_failure_at,
            last_success_at=agg_full.last_success_at,
        )
    if _recent_posture_recovered(agg_recent):
        return OutcomeAggregate(
            failure_count=0,
            success_count=agg_recent.success_count,
            retry_event_count=agg_recent.retry_event_count,
            retry_count_sum=agg_recent.retry_count_sum,
            rate_limit_count=agg_recent.rate_limit_count,
            latency_ms_avg=agg_recent.latency_ms_avg,
            latency_ms_p95=agg_recent.latency_ms_p95,
            last_failure_at=agg_recent.last_failure_at,
            last_success_at=agg_recent.last_success_at,
        )
    return agg_recent


def apply_recovery_floor(
    score: int,
    *,
    agg_full: OutcomeAggregate,
    agg_recent: OutcomeAggregate,
) -> int:
    """Boost score when recent posture is healthy after prior failures."""

    if not is_recovered_posture(agg_full):
        return score
    recent_fr = _ratio(
        agg_recent.failure_count,
        agg_recent.failure_count + agg_recent.success_count,
    )
    recent_n = agg_recent.failure_count + agg_recent.success_count
    if recent_n == 0 and agg_full.success_count > 0:
        return max(score, _RECOVERY_HEALTHY_FLOOR)
    if agg_recent.failure_count == 0 and agg_recent.success_count > 0:
        return max(score, _RECOVERY_HEALTHY_FLOOR)
    if _recent_posture_recovered(agg_recent) and agg_recent.success_count > 0:
        return max(score, _RECOVERY_HEALTHY_FLOOR)
    if recent_fr < 0.02 and agg_recent.success_count >= 3:
        return max(score, _RECOVERY_HEALTHY_FLOOR)
    if recent_fr < 0.1 and agg_recent.success_count >= 2:
        return max(score, _RECOVERY_DEGRADED_FLOOR)
    return score


def effective_failure_count_for_penalty(
    agg_full: OutcomeAggregate,
    agg_recent: OutcomeAggregate,
    *,
    now: datetime,
) -> int:
    """Repeated-failure penalty uses decayed full-window count, capped by recent failures."""

    if is_recovered_posture(agg_full) and (
        agg_recent.failure_count == 0 or _recent_posture_recovered(agg_recent)
    ):
        return 0
    decay = failure_decay_multiplier(agg_full, now=now)
    decayed = int(math.ceil(agg_full.failure_count * decay))
    return min(decayed, max(agg_recent.failure_count, decayed))


# --- Factor builders (shared; scoring aggregate may differ by mode) ---

_LATENCY_P95_DEGRADE_MS = 2000.0
_LATENCY_P95_BAD_MS = 5000.0


def _failure_rate_factor(rate: float) -> HealthFactor | None:
    if rate >= 0.5:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 50%",
            delta=-60,
            detail=f"failure_rate={rate:.2%} (50% threshold)",
        )
    if rate >= 0.25:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 25%",
            delta=-35,
            detail=f"failure_rate={rate:.2%} (25% threshold)",
        )
    if rate >= 0.1:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 10%",
            delta=-20,
            detail=f"failure_rate={rate:.2%} (10% threshold)",
        )
    if rate >= 0.02:
        return HealthFactor(
            code="failure_rate",
            label="Failure rate >= 2%",
            delta=-8,
            detail=f"failure_rate={rate:.2%} (2% threshold)",
        )
    return None


def _retry_rate_factor(rate: float, retry_event_count: int) -> HealthFactor | None:
    if retry_event_count <= 0:
        return None
    if rate >= 0.5:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 50%",
            delta=-25,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    if rate >= 0.25:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 25%",
            delta=-15,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    if rate >= 0.1:
        return HealthFactor(
            code="retry_rate",
            label="Retry rate >= 10%",
            delta=-5,
            detail=f"retry_rate={rate:.2%}, retry_events={retry_event_count}",
        )
    return None


def _inactivity_factor(agg: OutcomeAggregate) -> HealthFactor | None:
    if agg.failure_count > 0 and agg.success_count == 0:
        return HealthFactor(
            code="inactivity",
            label="No successful deliveries in window",
            delta=-25,
            detail=f"failures={agg.failure_count} success=0",
        )
    return None


def _repeated_failures_factor(failure_count: int) -> HealthFactor | None:
    if failure_count >= 50:
        return HealthFactor(
            code="repeated_failures",
            label="Sustained failure volume",
            delta=-15,
            detail=f"failure_count={failure_count} (>=50)",
        )
    if failure_count >= 20:
        return HealthFactor(
            code="repeated_failures",
            label="Elevated failure volume",
            delta=-10,
            detail=f"failure_count={failure_count} (>=20)",
        )
    if failure_count >= 10:
        return HealthFactor(
            code="repeated_failures",
            label="Increased failure volume",
            delta=-5,
            detail=f"failure_count={failure_count} (>=10)",
        )
    return None


def _rate_limit_factor(rate_limit_count: int) -> HealthFactor | None:
    if rate_limit_count >= 25:
        return HealthFactor(
            code="rate_limit_pressure",
            label="High rate-limit pressure",
            delta=-10,
            detail=f"rate_limited_events={rate_limit_count} (>=25)",
        )
    if rate_limit_count >= 5:
        return HealthFactor(
            code="rate_limit_pressure",
            label="Rate-limit pressure",
            delta=-5,
            detail=f"rate_limited_events={rate_limit_count} (>=5)",
        )
    return None


def _latency_factor(latency_ms_p95: float | None) -> HealthFactor | None:
    if latency_ms_p95 is None:
        return None
    if latency_ms_p95 >= _LATENCY_P95_BAD_MS:
        return HealthFactor(
            code="latency_p95",
            label="High p95 latency",
            delta=-10,
            detail=f"latency_ms_p95={int(latency_ms_p95)} (>={int(_LATENCY_P95_BAD_MS)} ms)",
        )
    if latency_ms_p95 >= _LATENCY_P95_DEGRADE_MS:
        return HealthFactor(
            code="latency_p95",
            label="Elevated p95 latency",
            delta=-5,
            detail=f"latency_ms_p95={int(latency_ms_p95)} (>={int(_LATENCY_P95_DEGRADE_MS)} ms)",
        )
    return None


def _build_factors(
    agg: OutcomeAggregate,
    *,
    include_latency: bool,
    effective_repeated_failures: int | None = None,
    skip_inactivity_when_recovered: bool = False,
    agg_full: OutcomeAggregate | None = None,
) -> list[HealthFactor]:
    total_outcomes = agg.failure_count + agg.success_count
    failure_rate = _ratio(agg.failure_count, total_outcomes)
    retry_rate = _ratio(agg.retry_event_count, total_outcomes) if total_outcomes else 0.0
    rep_failures = (
        effective_repeated_failures
        if effective_repeated_failures is not None
        else agg.failure_count
    )

    candidates: list[HealthFactor | None] = [
        _failure_rate_factor(failure_rate),
        _retry_rate_factor(retry_rate, agg.retry_event_count),
        None
        if skip_inactivity_when_recovered and agg_full is not None and is_recovered_posture(agg_full)
        else _inactivity_factor(agg),
        _repeated_failures_factor(rep_failures),
        _rate_limit_factor(agg.rate_limit_count),
    ]
    if include_latency:
        candidates.append(_latency_factor(agg.latency_ms_p95))
    return [f for f in candidates if f is not None]


def compute_health_score_for_mode(
    agg_full: OutcomeAggregate,
    agg_recent: OutcomeAggregate,
    *,
    scoring_mode: ScoringMode,
    include_latency: bool,
    now: datetime | None = None,
    recent_window_since: datetime | None = None,
    recent_window_until: datetime | None = None,
) -> HealthScore:
    """Score one entity using the selected scoring model."""

    now = now or datetime.now(UTC)
    window_kwargs = {
        "recent_window_since": recent_window_since,
        "recent_window_until": recent_window_until,
    }
    if scoring_mode == "historical_analytics":
        agg_score = agg_full
        factors = _build_factors(agg_score, include_latency=include_latency)
        raw = 100 + sum(int(f.delta) for f in factors)
        score = max(0, min(100, raw))
        metrics = build_health_metrics(
            agg_score,
            agg_full,
            agg_recent,
            scoring_mode=scoring_mode,
            **window_kwargs,
        )
        runtime_level = compute_health_score_for_mode(
            agg_full,
            agg_recent,
            scoring_mode="current_runtime",
            include_latency=include_latency,
            now=now,
            recent_window_since=recent_window_since,
            recent_window_until=recent_window_until,
        ).level
        metrics.current_runtime_health = runtime_level
        return HealthScore(
            score=score,
            level=_score_to_level(score),
            factors=factors,
            metrics=metrics,
            scoring_mode=scoring_mode,
        )

    agg_score = live_scoring_aggregate(agg_full, agg_recent)
    eff_rep = effective_failure_count_for_penalty(agg_full, agg_recent, now=now)
    factors = _build_factors(
        agg_score,
        include_latency=include_latency,
        effective_repeated_failures=eff_rep,
        skip_inactivity_when_recovered=True,
        agg_full=agg_full,
    )
    raw = 100 + sum(int(f.delta) for f in factors)
    score = max(0, min(100, raw))
    score = apply_recovery_floor(
        score,
        agg_full=agg_full,
        agg_recent=agg_recent,
    )
    score = max(0, min(100, score))
    metrics = build_health_metrics(
        agg_recent,
        agg_full,
        agg_recent,
        scoring_mode=scoring_mode,
        **window_kwargs,
    )
    return HealthScore(
        score=score,
        level=_score_to_level(score),
        factors=factors,
        metrics=metrics,
        scoring_mode=scoring_mode,
    )


__all__ = [
    "OutcomeAggregate",
    "ScoringMode",
    "apply_recovery_floor",
    "build_health_metrics",
    "compute_health_score_for_mode",
    "failure_decay_multiplier",
    "health_recovery_score",
    "is_recovered_posture",
    "live_scoring_aggregate",
    "recent_success_ratio",
    "resolve_recent_posture_window",
]
