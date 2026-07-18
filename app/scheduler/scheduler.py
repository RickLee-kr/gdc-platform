"""Periodic scheduler — invokes StreamRunner per enabled stream."""

from __future__ import annotations

import errno
import logging
import threading
from typing import Any, Callable

from app.database import SessionLocal
from app.runners.stream_runner_db import run_with_db
from app.scheduler.context_cache import load_scheduler_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.repository import get_enabled_stream_ids, get_stream_by_id
from app.scheduler import runtime_state as scheduler_runtime_state

logger = logging.getLogger(__name__)


def is_transient_scheduler_error(exc: BaseException) -> bool:
    """Return True for connection/pipe/timeout style errors that warrant backoff."""

    if isinstance(exc, (BrokenPipeError, ConnectionError, TimeoutError)):
        return True
    if isinstance(exc, OSError):
        if getattr(exc, "errno", None) in {errno.EPIPE, errno.ECONNREFUSED, errno.ETIMEDOUT, errno.ECONNRESET}:
            return True
        # errno 32 is EPIPE on Linux
        if getattr(exc, "errno", None) == 32:
            return True
    msg = str(exc).lower()
    needles = (
        "broken pipe",
        "connection refused",
        "connection reset",
        "timed out",
        "timeout",
        "connection aborted",
    )
    return any(n in msg for n in needles)


def compute_scheduler_backoff_wait_sec(*, interval: float, consecutive_failures: int) -> float:
    """Exponential backoff capped at 300s: min(300, interval * 2**min(failures, 5))."""

    failures = max(0, int(consecutive_failures))
    base = max(float(interval), 0.1)
    return float(min(300.0, base * (2 ** min(failures, 5))))


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
        self._injected_runner = runner
        self._thread_local = threading.local()
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._workers_lock = threading.Lock()
        self._workers: dict[int, threading.Thread] = {}
        self._backoff_lock = threading.Lock()
        self._stream_backoff: dict[int, dict[str, Any]] = {}

    def _runner_for_current_thread(self) -> StreamRunner:
        """One StreamRunner per worker thread — run-scoped state is not thread-safe on a shared instance."""

        if self._injected_runner is not None:
            return self._injected_runner
        runner = getattr(self._thread_local, "runner", None)
        if runner is None:
            runner = StreamRunner()
            self._thread_local.runner = runner
        return runner

    def stream_backoff_summary(self) -> dict[int, dict[str, Any]]:
        """Optional diagnostics: stream_id -> consecutive failures / last wait."""

        with self._backoff_lock:
            return {sid: dict(info) for sid, info in self._stream_backoff.items()}

    def _set_backoff(self, stream_id: int, *, failures: int, wait_sec: float, last_error: str | None) -> None:
        with self._backoff_lock:
            if failures <= 0:
                self._stream_backoff.pop(stream_id, None)
                return
            self._stream_backoff[stream_id] = {
                "consecutive_failures": int(failures),
                "wait_sec": float(wait_sec),
                "last_error": (last_error or "")[:300] or None,
            }

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
        """Run one stream once via a thread-local StreamRunner (class-level rate-limit locks remain shared)."""

        return self._runner_for_current_thread().run(stream)

    def run_stream_by_id(self, stream_id: int) -> dict[str, Any]:
        """Load stream context from DB and run by stream_id."""

        context = load_scheduler_stream_context(stream_id)
        return self._runner_for_current_thread().run(context)

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
        consecutive_failures = 0
        try:
            while not self._stop_event.is_set():
                interval = 60.0
                context = None
                wait_sec = interval
                cycle_error: BaseException | None = None
                try:
                    def _stream_loop_gate(db):
                        row = get_stream_by_id(db, stream_id)
                        if row is None:
                            return None
                        # Read scalars inside the session — row is expired after run_with_db closes.
                        return {
                            "enabled": bool(row.enabled),
                            "polling_interval": float(row.polling_interval or 60),
                            "name": row.name,
                        }

                    gate = run_with_db(_stream_loop_gate)
                    if gate is None:
                        logger.info(
                            "%s",
                            {"stage": "scheduler_loop_exit", "stream_id": stream_id, "reason": "stream_missing"},
                        )
                        break
                    if not gate["enabled"]:
                        logger.info(
                            "%s",
                            {"stage": "scheduler_loop_exit", "stream_id": stream_id, "reason": "stream_disabled"},
                        )
                        break
                    interval = float(gate["polling_interval"])

                    from app.dev_validation_lab.runtime_gates import is_lab_fixture_stream
                    from app.dev_validation_lab.lab_resource_guardrail import lab_generation_should_pause

                    if is_lab_fixture_stream(gate.get("name")):
                        paused, pause_reason = lab_generation_should_pause()
                        if paused:
                            from app.config import settings

                            wait_sec = float(
                                getattr(settings, "GDC_LAB_PAUSE_BACKOFF_SECONDS", 30.0) or 30.0
                            )
                            wait_sec = max(wait_sec, float(interval))
                            logger.warning(
                                "%s",
                                {
                                    "stage": "scheduler_lab_stream_paused",
                                    "stream_id": stream_id,
                                    "stream_name": gate.get("name"),
                                    "reason": pause_reason,
                                    "wait_sec": wait_sec,
                                },
                            )
                            self._stop_event.wait(wait_sec)
                            continue

                    context = load_scheduler_stream_context(stream_id)
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
                    cycle_error = exc
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
                    cycle_error = exc
                    logger.error(
                        "%s",
                        {
                            "stage": "scheduler_stream_error",
                            "stream_id": stream_id,
                            "error_type": type(exc).__name__,
                            "message": str(exc),
                        },
                    )

                if context is not None:
                    try:
                        self._runner_for_current_thread().run(context)
                        consecutive_failures = 0
                        self._set_backoff(stream_id, failures=0, wait_sec=interval, last_error=None)
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
                        cycle_error = exc
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
                        cycle_error = exc
                        logger.error(
                            "%s",
                            {
                                "stage": "scheduler_stream_error",
                                "stream_id": stream_id,
                                "error_type": type(exc).__name__,
                                "message": str(exc),
                            },
                        )

                wait_sec = max(interval, 0.1)
                if cycle_error is not None and is_transient_scheduler_error(cycle_error):
                    consecutive_failures += 1
                    wait_sec = compute_scheduler_backoff_wait_sec(
                        interval=interval, consecutive_failures=consecutive_failures
                    )
                    self._set_backoff(
                        stream_id,
                        failures=consecutive_failures,
                        wait_sec=wait_sec,
                        last_error=str(cycle_error),
                    )
                    logger.warning(
                        "%s",
                        {
                            "stage": "scheduler_stream_backoff",
                            "stream_id": stream_id,
                            "failures": consecutive_failures,
                            "wait_sec": wait_sec,
                            "last_error": str(cycle_error)[:300],
                            "error_type": type(cycle_error).__name__,
                        },
                    )
                elif cycle_error is not None:
                    # Non-transient: keep base interval but do not reset success counter mid-failure streak
                    # unless we never entered backoff (leave consecutive_failures unchanged only for transient).
                    pass

                self._stop_event.wait(wait_sec)
        finally:
            with self._workers_lock:
                self._workers.pop(stream_id, None)
            with self._backoff_lock:
                self._stream_backoff.pop(stream_id, None)
            logger.info("%s", {"stage": "scheduler_worker_stopped", "stream_id": stream_id})
