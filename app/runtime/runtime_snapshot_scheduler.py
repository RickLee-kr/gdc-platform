"""Background scheduler for physical operational snapshot read model updates."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from app.config import settings
from app.database import SessionLocal
from app.runtime.runtime_snapshot_updater import run_runtime_snapshot_update

logger = logging.getLogger(__name__)
UTC = timezone.utc

_DEFAULT_TICK_SECONDS = 30.0
_MIN_SLEEP_SECONDS = 5.0

_runtime_snapshot_scheduler: RuntimeSnapshotScheduler | None = None


class RuntimeSnapshotScheduler:
    """Single daemon thread; overlap prevention delegated to updater guard."""

    def __init__(self, *, tick_seconds: float | None = None) -> None:
        self._tick_seconds = float(
            tick_seconds
            or getattr(settings, "GDC_RUNTIME_OPERATIONAL_SNAPSHOT_UPDATER_INTERVAL_SECONDS", _DEFAULT_TICK_SECONDS)
        )
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._started_at: datetime | None = None
        self._last_tick_at: datetime | None = None
        self._last_error: str | None = None
        self._bootstrap_done = False

    @property
    def started_at(self) -> datetime | None:
        return self._started_at

    def is_running(self) -> bool:
        t = self._thread
        return t is not None and t.is_alive()

    def last_tick_at(self) -> datetime | None:
        return self._last_tick_at

    def last_error(self) -> str | None:
        return self._last_error

    def start(self) -> None:
        if not bool(getattr(settings, "GDC_RUNTIME_OPERATIONAL_SNAPSHOT_UPDATER_ENABLED", True)):
            logger.info("%s", {"stage": "runtime_snapshot_scheduler_disabled"})
            return
        if self.is_running():
            return
        self._stop_event.clear()
        self._started_at = datetime.now(UTC)
        self._thread = threading.Thread(
            target=self._loop,
            name="runtime-snapshot-scheduler",
            daemon=True,
        )
        self._thread.start()
        logger.info("%s", {"stage": "runtime_snapshot_scheduler_started"})

    def stop(self) -> None:
        self._stop_event.set()
        t = self._thread
        if t is not None:
            t.join(timeout=5.0)
        self._thread = None
        logger.info("%s", {"stage": "runtime_snapshot_scheduler_stopped"})

    def trigger_once(self, *, bootstrap: bool = False) -> None:
        self._tick(bootstrap=bootstrap or not self._bootstrap_done)

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick(bootstrap=not self._bootstrap_done)
            except Exception as exc:  # pragma: no cover
                logger.exception(
                    "%s",
                    {
                        "stage": "runtime_snapshot_scheduler_error",
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )
            self._stop_event.wait(max(self._tick_seconds, _MIN_SLEEP_SECONDS))

    def _tick(self, *, bootstrap: bool) -> None:
        self._last_tick_at = datetime.now(UTC)
        db = SessionLocal()
        try:
            outcome = run_runtime_snapshot_update(db, bootstrap_last_outcomes=bootstrap)
            if outcome.error:
                self._last_error = outcome.error
            else:
                self._last_error = None
            if bootstrap and outcome.result is not None:
                self._bootstrap_done = True
        finally:
            db.close()


def register_runtime_snapshot_scheduler(scheduler: RuntimeSnapshotScheduler | None) -> None:
    global _runtime_snapshot_scheduler
    _runtime_snapshot_scheduler = scheduler


def get_runtime_snapshot_scheduler() -> RuntimeSnapshotScheduler | None:
    return _runtime_snapshot_scheduler
