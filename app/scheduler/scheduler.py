"""Periodic scheduler — invokes StreamRunner per enabled stream."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from app.database import SessionLocal
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.repository import get_enabled_stream_ids

logger = logging.getLogger(__name__)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


class Scheduler:
    """Simple thread-based stream scheduler.

    This scheduler uses per-stream worker threads and an in-memory control event.
    """

    def __init__(
        self,
        streams_provider: Callable[[], list[Any]] | None = None,
        runner: StreamRunner | None = None,
    ) -> None:
        self._streams_provider = streams_provider or (lambda: [])
        self._runner = runner or StreamRunner()
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        """Start polling threads for all enabled streams."""

        self._stop_event.clear()
        streams = [s for s in self._streams_provider() if bool(_get(s, "enabled", True))]
        for stream in streams:
            thread = threading.Thread(
                target=self._loop_stream,
                args=(stream,),
                daemon=True,
                name=f"stream-scheduler-{_get(stream, 'id', 'unknown')}",
            )
            thread.start()
            self._threads.append(thread)
            logger.info("%s", {"stage": "scheduler_start_stream", "stream_id": _get(stream, "id")})

    def stop(self) -> None:
        """Stop all scheduler threads gracefully."""

        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=2.0)
        self._threads.clear()
        logger.info("%s", {"stage": "scheduler_stopped"})

    def run_stream(self, stream: Any) -> None:
        """Run one stream once via StreamRunner."""

        self._runner.run(stream)

    def run_stream_by_id(self, stream_id: int) -> None:
        """Load stream context from DB and run by stream_id."""

        db = SessionLocal()
        try:
            context = load_stream_context(db, stream_id)
            self._runner.run(context, db=db)
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

    def _loop_stream(self, stream: Any) -> None:
        stream_id = _get(stream, "id")
        while not self._stop_event.is_set():
            try:
                self.run_stream(stream)
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

            interval = float(_get(stream, "polling_interval", _get(_get(stream, "stream_config", {}), "polling_interval", 60)))
            self._stop_event.wait(max(interval, 0.1))
