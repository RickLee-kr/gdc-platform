"""Periodic scheduler — invokes StreamRunner per enabled stream."""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable

from app.database import SessionLocal
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.repository import get_enabled_stream_ids, get_stream_by_id
from app.scheduler import runtime_state as scheduler_runtime_state

logger = logging.getLogger(__name__)


class Scheduler:
    """Thread-based stream scheduler.

    A supervisor periodically discovers enabled streams and starts a long-lived worker per stream_id.
    Each worker reloads DB-backed context every poll cycle (fresh mapping/routes/checkpoint).
    """

    _SUPERVISOR_INTERVAL_SEC = 12.0

    def __init__(
        self,
        streams_provider: Callable[[], list[Any]] | None = None,
        runner: StreamRunner | None = None,
    ) -> None:
        self._streams_provider = streams_provider  # retained for compatibility; start() does not use it
        self._runner = runner or StreamRunner()
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._workers_lock = threading.Lock()
        self._workers: dict[int, threading.Thread] = {}

    def start(self) -> None:
        """Start supervisor thread that spawns per-stream polling workers."""

        scheduler_runtime_state.mark_scheduler_started()
        self._stop_event.clear()
        supervisor = threading.Thread(
            target=self._supervisor_loop,
            daemon=True,
            name="stream-scheduler-supervisor",
        )
        supervisor.start()
        self._threads.append(supervisor)
        logger.info("%s", {"stage": "scheduler_supervisor_started"})

    def stop(self) -> None:
        """Stop supervisor and wait for worker threads to finish."""

        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=5.0)
        self._threads.clear()
        with self._workers_lock:
            self._workers.clear()
        logger.info("%s", {"stage": "scheduler_stopped"})

    def run_stream(self, stream: Any) -> dict[str, Any]:
        """Run one stream once via StreamRunner."""

        return self._runner.run(stream)

    def run_stream_by_id(self, stream_id: int) -> dict[str, Any]:
        """Load stream context from DB and run by stream_id."""

        db = SessionLocal()
        try:
            context = load_stream_context(db, stream_id)
            return self._runner.run(context, db=db)
        finally:
            db.close()

    def schedule_enabled_streams(self) -> list[int]:
        """Load enabled stream IDs and run each once by stream_id."""

        db = SessionLocal()
        try:
            stream_ids = get_enabled_stream_ids(db)
        finally:
            db.close()
        for stream_id in stream_ids:
            self.run_stream_by_id(stream_id)
        return stream_ids

    def _supervisor_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                db = SessionLocal()
                try:
                    enabled_ids = get_enabled_stream_ids(db)
                finally:
                    db.close()

                for sid in enabled_ids:
                    if self._stop_event.is_set():
                        break
                    self._ensure_worker(int(sid))
            except Exception as exc:  # pragma: no cover - defensive
                logger.error(
                    "%s",
                    {
                        "stage": "scheduler_supervisor_error",
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )

            self._stop_event.wait(self._SUPERVISOR_INTERVAL_SEC)

    def alive_worker_count(self) -> int:
        """Count scheduler worker threads that are still alive."""

        with self._workers_lock:
            return sum(1 for t in self._workers.values() if t.is_alive())

    def _ensure_worker(self, stream_id: int) -> None:
        with self._workers_lock:
            existing = self._workers.get(stream_id)
            if existing is not None:
                if existing.is_alive():
                    return
                self._workers.pop(stream_id, None)

            thread = threading.Thread(
                target=self._loop_stream,
                args=(stream_id,),
                daemon=True,
                name=f"stream-scheduler-{stream_id}",
            )
            self._workers[stream_id] = thread
            thread.start()
            logger.info("%s", {"stage": "scheduler_worker_spawned", "stream_id": stream_id})

    def _loop_stream(self, stream_id: int) -> None:
        try:
            while not self._stop_event.is_set():
                interval = 60.0
                db = SessionLocal()
                try:
                    row = get_stream_by_id(db, stream_id)
                    if row is None:
                        logger.info(
                            "%s",
                            {"stage": "scheduler_loop_exit", "stream_id": stream_id, "reason": "stream_missing"},
                        )
                        break
                    if not bool(row.enabled):
                        logger.info(
                            "%s",
                            {"stage": "scheduler_loop_exit", "stream_id": stream_id, "reason": "stream_disabled"},
                        )
                        break
                    interval = float(row.polling_interval or 60)

                    context = load_stream_context(db, stream_id)
                    self._runner.run(context, db=db)
                except ValueError as exc:
                    msg = str(exc).lower()
                    if (
                        "disabled" in msg
                        or "no enabled routes" in msg
                        or "destination row missing" in msg
                        or "stream disabled" in msg
                    ):
                        logger.warning(
                            "%s",
                            {
                                "stage": "scheduler_context_unavailable",
                                "stream_id": stream_id,
                                "message": str(exc),
                            },
                        )
                        break
                    logger.error(
                        "%s",
                        {
                            "stage": "scheduler_stream_error",
                            "stream_id": stream_id,
                            "error_type": type(exc).__name__,
                            "message": str(exc),
                        },
                    )
                except Exception as exc:  # pragma: no cover - runtime guard
                    logger.error(
                        "%s",
                        {
                            "stage": "scheduler_stream_error",
                            "stream_id": stream_id,
                            "error_type": type(exc).__name__,
                            "message": str(exc),
                        },
                    )
                finally:
                    db.close()

                self._stop_event.wait(max(interval, 0.1))
        finally:
            with self._workers_lock:
                self._workers.pop(stream_id, None)
            logger.info("%s", {"stage": "scheduler_worker_stopped", "stream_id": stream_id})
