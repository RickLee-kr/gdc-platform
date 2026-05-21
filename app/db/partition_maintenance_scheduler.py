"""Background partition maintenance (create future months, orphan detection)."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from app.config import settings
from app.db.partition_maintenance import PartitionMaintenanceResult, run_partition_maintenance

logger = logging.getLogger(__name__)
UTC = timezone.utc

_DEFAULT_TICK_SECONDS = 3600.0
_MIN_SLEEP_SECONDS = 30.0

_partition_maintenance_scheduler: PartitionMaintenanceScheduler | None = None


class PartitionMaintenanceScheduler:
    """Lightweight daemon that ensures monthly delivery_logs partitions exist."""

    def __init__(self, *, tick_seconds: float | None = None) -> None:
        self._tick_seconds = float(tick_seconds or _DEFAULT_TICK_SECONDS)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._started_at: datetime | None = None
        self._last_tick_at: datetime | None = None
        self._last_result: PartitionMaintenanceResult | None = None
        self._lock = threading.RLock()

    @property
    def started_at(self) -> datetime | None:
        return self._started_at

    def is_running(self) -> bool:
        t = self._thread
        return t is not None and t.is_alive()

    def last_tick_at(self) -> datetime | None:
        return self._last_tick_at

    def last_result(self) -> PartitionMaintenanceResult | None:
        return self._last_result

    def start(self) -> None:
        if not bool(settings.GDC_PARTITION_MAINTENANCE_ENABLED):
            logger.info("%s", {"stage": "partition_maintenance_scheduler_disabled"})
            return
        if self.is_running():
            return
        self._stop_event.clear()
        self._started_at = datetime.now(UTC)
        self._thread = threading.Thread(
            target=self._loop,
            name="partition-maintenance-scheduler",
            daemon=True,
        )
        self._thread.start()
        logger.info("%s", {"stage": "partition_maintenance_scheduler_started"})

    def stop(self) -> None:
        self._stop_event.set()
        t = self._thread
        if t is not None:
            t.join(timeout=5.0)
        self._thread = None
        logger.info("%s", {"stage": "partition_maintenance_scheduler_stopped"})

    def trigger_once(self) -> PartitionMaintenanceResult | None:
        return self._sweep()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._sweep()
            except Exception as exc:  # pragma: no cover
                logger.exception(
                    "%s",
                    {
                        "stage": "partition_maintenance_scheduler_error",
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )
            self._stop_event.wait(max(self._tick_seconds, _MIN_SLEEP_SECONDS))

    def _sweep(self) -> PartitionMaintenanceResult | None:
        from app.database import SessionLocal

        with self._lock:
            self._last_tick_at = datetime.now(UTC)
            db = SessionLocal()
            try:
                result = run_partition_maintenance(
                    db,
                    months_ahead=max(1, int(settings.GDC_PARTITION_MAINTENANCE_MONTHS_AHEAD)),
                )
                self._last_result = result
                logger.info(
                    "%s",
                    {
                        "stage": "partition_maintenance_tick",
                        "status": result.status,
                        "ensured": result.ensured_partitions,
                        "orphans": result.orphan_partitions,
                    },
                )
                return result
            finally:
                db.close()


def register_partition_maintenance_scheduler(scheduler: PartitionMaintenanceScheduler | None) -> None:
    global _partition_maintenance_scheduler
    _partition_maintenance_scheduler = scheduler


def get_partition_maintenance_scheduler() -> PartitionMaintenanceScheduler | None:
    return _partition_maintenance_scheduler


__all__ = [
    "PartitionMaintenanceScheduler",
    "get_partition_maintenance_scheduler",
    "register_partition_maintenance_scheduler",
]
