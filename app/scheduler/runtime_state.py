"""Process-local scheduler diagnostics for runtime APIs (no DB)."""

from __future__ import annotations

import weakref
from datetime import datetime, timezone
from typing import Any

_scheduler_started_at: datetime | None = None
_scheduler_ref: weakref.ref | None = None


def mark_scheduler_started() -> None:
    """Record UTC time when the scheduler supervisor starts (once per process)."""

    global _scheduler_started_at
    if _scheduler_started_at is None:
        _scheduler_started_at = datetime.now(timezone.utc)


def register_scheduler_instance(scheduler: Any) -> None:
    """Hold a weak reference for worker/thread introspection."""

    global _scheduler_ref
    _scheduler_ref = weakref.ref(scheduler)


def scheduler_started_at() -> datetime | None:
    return _scheduler_started_at


def active_worker_count() -> int | None:
    """Return live worker threads if a scheduler instance is registered."""

    ref = _scheduler_ref
    if ref is None:
        return None
    sched = ref()
    if sched is None:
        return None
    return int(sched.alive_worker_count())


def scheduler_uptime_seconds(now: datetime | None = None) -> float | None:
    started = _scheduler_started_at
    if started is None:
        return None
    t = now or datetime.now(timezone.utc)
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    delta = (t - started.astimezone(timezone.utc)).total_seconds()
    return max(0.0, float(delta))
