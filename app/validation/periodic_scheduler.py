"""Background supervisor for periodic continuous validation (independent from stream polling scheduler)."""

from __future__ import annotations

import logging
import threading
from typing import Any

from app.config import settings
from app.database import SessionLocal, utcnow
from app.dev_validation_lab.validation_gates import lab_validation_should_execute
from app.startup_readiness import get_startup_snapshot
from app.validation.models import ContinuousValidation
from app.validation.runner import execute_continuous_validation_row

logger = logging.getLogger(__name__)


def _seconds_since_last_run(row: ContinuousValidation) -> float | None:
    last = row.last_run_at
    if last is None:
        return None
    return max(0.0, (utcnow() - last).total_seconds())


class ContinuousValidationScheduler:
    """Single supervisor thread that triggers due validation definitions."""

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        self._stop.clear()
        t = threading.Thread(
            target=self._supervisor_loop,
            daemon=True,
            name="continuous-validation-scheduler",
        )
        t.start()
        self._threads.append(t)
        logger.info("%s", {"stage": "continuous_validation_scheduler_started"})

    def stop(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=5.0)
        self._threads.clear()
        logger.info("%s", {"stage": "continuous_validation_scheduler_stopped"})

    def _supervisor_loop(self) -> None:
        interval = max(3.0, float(settings.VALIDATION_SUPERVISOR_INTERVAL_SEC))
        while not self._stop.is_set():
            try:
                snap = get_startup_snapshot()
                if not snap.schema_ready:
                    self._stop.wait(interval)
                    continue

                db = SessionLocal()
                try:
                    rows = list(
                        db.query(ContinuousValidation)
                        .filter(ContinuousValidation.enabled.is_(True))
                        .order_by(ContinuousValidation.id.asc())
                        .all()
                    )
                except Exception as exc:  # pragma: no cover - migration not applied yet
                    logger.warning(
                        "%s",
                        {
                            "stage": "continuous_validation_scheduler_query_failed",
                            "error_type": type(exc).__name__,
                            "message": str(exc),
                        },
                    )
                    rows = []
                finally:
                    db.close()

                for row in rows:
                    if self._stop.is_set():
                        break
                    sched = max(10, int(row.schedule_seconds or 300))
                    elapsed = _seconds_since_last_run(row)
                    if elapsed is not None and elapsed < float(sched):
                        continue

                    db2 = SessionLocal()
                    try:
                        fresh = db2.get(ContinuousValidation, row.id)
                        if fresh is None or not bool(fresh.enabled):
                            continue
                        if not lab_validation_should_execute(fresh):
                            continue
                        execute_continuous_validation_row(fresh)
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.error(
                            "%s",
                            {
                                "stage": "continuous_validation_scheduler_run_failed",
                                "validation_id": int(row.id),
                                "error_type": type(exc).__name__,
                                "message": str(exc),
                            },
                        )
                    finally:
                        db2.close()
            except Exception as exc:  # pragma: no cover
                logger.error(
                    "%s",
                    {
                        "stage": "continuous_validation_supervisor_error",
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )

            self._stop.wait(interval)


_validation_scheduler_ref: Any = None


def get_validation_scheduler() -> ContinuousValidationScheduler | None:
    return _validation_scheduler_ref


def set_validation_scheduler(inst: ContinuousValidationScheduler | None) -> None:
    global _validation_scheduler_ref
    _validation_scheduler_ref = inst
