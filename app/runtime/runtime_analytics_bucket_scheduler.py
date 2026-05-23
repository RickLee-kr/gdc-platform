"""Background scheduler for historical analytics bucket updater."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from app.config import settings
from app.database import SessionLocal
from app.runtime.runtime_analytics_bucket_updater import run_runtime_analytics_bucket_update

logger = logging.getLogger(__name__)
UTC = timezone.utc

_DEFAULT_TICK_SECONDS = 30.0
_MIN_SLEEP_SECONDS = 5.0

_runtime_analytics_bucket_scheduler: RuntimeAnalyticsBucketScheduler | None = None


class RuntimeAnalyticsBucketScheduler:
    """Single daemon thread; overlap prevention delegated to updater guard."""

    def __init__(self, *, tick_seconds: float | None = None) -> None:
        self._tick_seconds = float(
            tick_seconds
            or getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_INTERVAL_SECONDS", _DEFAULT_TICK_SECONDS)
        )
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._started_at: datetime | None = None
        self._last_tick_at: datetime | None = None
        self._last_error: str | None = None

    def is_running(self) -> bool:
        t = self._thread
        return t is not None and t.is_alive()

    def start(self) -> None:
        if not bool(getattr(settings, "GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_ENABLED", True)):
            logger.info("%s", {"stage": "runtime_analytics_bucket_scheduler_disabled"})
            return
        if self.is_running():
            return
        self._stop_event.clear()
        self._started_at = datetime.now(UTC)
        self._thread = threading.Thread(
            target=self._loop,
            name="runtime-analytics-bucket-scheduler",
            daemon=True,
        )
        self._thread.start()
        logger.info("%s", {"stage": "runtime_analytics_bucket_scheduler_started"})

    def stop(self) -> None:
        self._stop_event.set()
        t = self._thread
        if t is not None:
            t.join(timeout=5.0)
        self._thread = None
        logger.info("%s", {"stage": "runtime_analytics_bucket_scheduler_stopped"})

    def trigger_once(self) -> None:
        self._tick()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as exc:  # pragma: no cover
                logger.exception(
                    "%s",
                    {
                        "stage": "runtime_analytics_bucket_scheduler_error",
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )
            self._stop_event.wait(max(self._tick_seconds, _MIN_SLEEP_SECONDS))

    def _tick(self) -> None:
        self._last_tick_at = datetime.now(UTC)
        db = SessionLocal()
        try:
            outcome = run_runtime_analytics_bucket_update(db)
            self._last_error = outcome.error
        finally:
            db.close()


def register_runtime_analytics_bucket_scheduler(
    scheduler: RuntimeAnalyticsBucketScheduler | None,
) -> None:
    global _runtime_analytics_bucket_scheduler
    _runtime_analytics_bucket_scheduler = scheduler


def get_runtime_analytics_bucket_scheduler() -> RuntimeAnalyticsBucketScheduler | None:
    return _runtime_analytics_bucket_scheduler
