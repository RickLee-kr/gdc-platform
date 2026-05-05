"""StreamRunner — coordinates pipeline for HTTP (and future DB/webhook) streams."""

from __future__ import annotations

import logging
import threading
import time
from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from app.checkpoints.service import CheckpointService
from app.delivery.syslog_sender import SyslogSender
from app.delivery.webhook_sender import WebhookSender
from app.enrichers.enrichment_engine import apply_enrichments
from app.mappers.mapper import apply_mappings
from app.parsers.event_extractor import extract_events
from app.pollers.http_poller import HttpPoller
from app.rate_limit.destination_limiter import DestinationRateLimiter
from app.rate_limit.source_limiter import SourceRateLimiter
from app.routes.repository import disable_route
from app.runtime.errors import DestinationSendError
from app.runtime.stream_context import StreamContext
from app.streams.repository import update_stream_status
from app.runners.base import BaseRunner

logger = logging.getLogger(__name__)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, dict):
        return data.get(key, default)
    return getattr(data, key, default)


class StreamRunner(BaseRunner):
    """Source -> extract -> mapping -> enrichment -> fan-out -> checkpoint update."""

    _locks: dict[int, threading.Lock] = {}
    _locks_guard = threading.Lock()

    def __init__(
        self,
        *,
        poller: HttpPoller | None = None,
        source_limiter: SourceRateLimiter | None = None,
        destination_limiter: DestinationRateLimiter | None = None,
        checkpoint_service: CheckpointService | None = None,
        syslog_sender: SyslogSender | None = None,
        webhook_sender: WebhookSender | None = None,
    ) -> None:
        self.poller = poller or HttpPoller()
        self.source_limiter = source_limiter or SourceRateLimiter()
        self.destination_limiter = destination_limiter or DestinationRateLimiter()
        self.checkpoint_service = checkpoint_service or CheckpointService()
        self.syslog_sender = syslog_sender or SyslogSender()
        self.webhook_sender = webhook_sender or WebhookSender()
        self._active_db: Session | None = None

    def run(self, stream: Any, db: Session | None = None) -> None:
        """Execute one stream cycle.

        The argument may be a stream object or dict that contains at least:
        ``id``, ``source_config``, ``stream_config``, ``routes``.
        """

        runtime_stream = stream.stream if isinstance(stream, StreamContext) else stream
        runtime_checkpoint = stream.checkpoint if isinstance(stream, StreamContext) else None
        self._active_db = db

        stream_id = int(_get(runtime_stream, "id"))
        lock = self._get_lock(stream_id)
        if not lock.acquire(blocking=False):
            self._log({"stage": "run_skip", "stream_id": stream_id, "message": "stream already running"})
            return

        try:
            if not self.source_limiter.allow(stream_id):
                self._set_stream_status(runtime_stream, "RATE_LIMITED_SOURCE")
                self._log(
                    {
                        "stage": "source_rate_limited",
                        "stream_id": stream_id,
                        "message": "source rate limited",
                    }
                )
                return

            source_config = _get(runtime_stream, "source_config", {}) or {}
            stream_config = _get(runtime_stream, "stream_config", {}) or {}
            checkpoint_type = "CUSTOM_FIELD"
            checkpoint = runtime_checkpoint
            if isinstance(runtime_checkpoint, dict) and "value" in runtime_checkpoint:
                checkpoint = runtime_checkpoint.get("value")
                checkpoint_type = str(runtime_checkpoint.get("type", "CUSTOM_FIELD"))
            if checkpoint is None:
                if db is not None:
                    db_checkpoint = self.checkpoint_service.get_checkpoint(db, stream_id)
                    if isinstance(db_checkpoint, dict) and "value" in db_checkpoint:
                        checkpoint = db_checkpoint.get("value")
                        checkpoint_type = str(db_checkpoint.get("type", "CUSTOM_FIELD"))
                    else:
                        checkpoint = db_checkpoint
                else:
                    checkpoint = self.checkpoint_service.get_checkpoint_for_stream(stream_id)

            raw_response = self.poller.fetch(source_config, stream_config, checkpoint)
            events = extract_events(raw_response, _get(stream_config, "event_array_path"))
            mapped_events = apply_mappings(events, _get(runtime_stream, "field_mappings", {}) or {})
            enriched_events = apply_enrichments(
                mapped_events,
                _get(runtime_stream, "enrichment", {}) or {},
                override_policy=str(_get(runtime_stream, "override_policy", "KEEP_EXISTING")),
            )

            successful_events = self._fan_out(runtime_stream, enriched_events)

            if successful_events:
                if db is not None:
                    checkpoint_value = {"last_success_event": deepcopy(successful_events[-1])}
                    self.checkpoint_service.update_checkpoint_after_success(
                        db=db,
                        stream_id=stream_id,
                        checkpoint_type=checkpoint_type,
                        checkpoint_value=checkpoint_value,
                    )
                else:
                    self.checkpoint_service.update(stream_id, successful_events[-1])

            self._log(
                {
                    "stage": "run_complete",
                    "stream_id": stream_id,
                    "input_events": len(events),
                    "success_events": len(successful_events),
                }
            )
        except Exception as exc:
            self._log(
                {
                    "stage": "run_failed",
                    "stream_id": stream_id,
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                }
            )
            raise
        finally:
            self._active_db = None
            lock.release()

    def _fan_out(self, stream: Any, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Send events to all enabled routes and return globally successful events."""

        stream_id = int(_get(stream, "id"))
        routes = list(_get(stream, "routes", []) or [])
        if not routes or not events:
            return []

        all_required_routes_succeeded = True

        for route in routes:
            route_id = int(_get(route, "id", 0))
            if not bool(_get(route, "enabled", True)):
                self._log({"stage": "route_skip", "stream_id": stream_id, "route_id": route_id})
                continue

            if not self.destination_limiter.allow(route_id):
                self._set_stream_status(stream, "RATE_LIMITED_DESTINATION")
                self._log(
                    {
                        "stage": "destination_rate_limited",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "message": "destination rate limited",
                    }
                )
                all_required_routes_succeeded = False
                continue

            destination = _get(route, "destination", {}) or {}
            destination_type = str(_get(destination, "destination_type", "")).upper()
            destination_config = _get(destination, "config", {}) or {}

            try:
                self._send_to_destination(destination_type, events, destination_config)
                self._log(
                    {
                        "stage": "route_send_success",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "destination_type": destination_type,
                        "event_count": len(events),
                    }
                )
            except Exception as exc:
                recovered = self._apply_failure_policy(stream, route, events, exc)
                if not recovered:
                    all_required_routes_succeeded = False

        if all_required_routes_succeeded:
            return deepcopy(events)
        return []

    def _send_to_destination(
        self,
        destination_type: str,
        events: list[dict[str, Any]],
        destination_config: dict[str, Any],
    ) -> None:
        if destination_type.startswith("SYSLOG"):
            self.syslog_sender.send(events, destination_config)
            return
        if destination_type == "WEBHOOK_POST":
            self.webhook_sender.send(events, destination_config)
            return
        raise DestinationSendError(f"Unsupported destination type: {destination_type}")

    def _apply_failure_policy(
        self, stream: Any, route: Any, events: list[dict[str, Any]], error: Exception
    ) -> bool:
        """Apply route-level failure policy."""

        stream_id = int(_get(stream, "id"))
        route_id = int(_get(route, "id", 0))
        policy = str(_get(route, "failure_policy", "LOG_AND_CONTINUE")).upper()
        self._log(
            {
                "stage": "route_send_failed",
                "stream_id": stream_id,
                "route_id": route_id,
                "failure_policy": policy,
                "error_type": type(error).__name__,
                "message": str(error),
            }
        )

        if policy == "LOG_AND_CONTINUE":
            return True

        if policy == "PAUSE_STREAM_ON_FAILURE":
            self._set_stream_status(stream, "PAUSED")
            return False

        if policy == "DISABLE_ROUTE_ON_FAILURE":
            self._set_route_enabled(route, False)
            return False

        if policy == "RETRY_AND_BACKOFF":
            retry_count = int(_get(route, "retry_count", 2))
            backoff_seconds = float(_get(route, "backoff_seconds", 1.0))
            destination = _get(route, "destination", {}) or {}
            destination_type = str(_get(destination, "destination_type", "")).upper()
            destination_config = _get(destination, "config", {}) or {}
            if not events:
                return False

            last_exc: Exception | None = None
            for idx in range(retry_count):
                try:
                    self._send_to_destination(destination_type, events, destination_config)
                    self._log(
                        {
                            "stage": "route_retry_success",
                            "stream_id": stream_id,
                            "route_id": route_id,
                            "attempt": idx + 1,
                        }
                    )
                    return True
                except Exception as exc:  # pragma: no cover - defensive
                    last_exc = exc
                    time.sleep(max(backoff_seconds * (2 ** idx), 0))
            self._log(
                {
                    "stage": "route_retry_failed",
                    "stream_id": stream_id,
                    "route_id": route_id,
                    "retry_count": retry_count,
                    "error_type": type(last_exc).__name__ if last_exc else None,
                    "message": str(last_exc) if last_exc else "retry failed",
                }
            )
            return False

        self._log(
            {
                "stage": "route_unknown_failure_policy",
                "stream_id": stream_id,
                "route_id": route_id,
                "failure_policy": policy,
            }
        )
        return False

    def _set_stream_status(self, stream: Any, status: str) -> None:
        if self._active_db is not None and hasattr(self._active_db, "query"):
            update_stream_status(self._active_db, int(_get(stream, "id")), status)
        if isinstance(stream, dict):
            stream["status"] = status
        else:
            setattr(stream, "status", status)

    def _set_route_enabled(self, route: Any, enabled: bool) -> None:
        if self._active_db is not None and hasattr(self._active_db, "query") and enabled is False:
            disable_route(self._active_db, int(_get(route, "id")))
        if isinstance(route, dict):
            route["enabled"] = enabled
        else:
            setattr(route, "enabled", enabled)

    @classmethod
    def _get_lock(cls, stream_id: int) -> threading.Lock:
        with cls._locks_guard:
            if stream_id not in cls._locks:
                cls._locks[stream_id] = threading.Lock()
            return cls._locks[stream_id]

    def _log(self, payload: dict[str, Any]) -> None:
        """Emit structured logs as dict payload."""

        logger.info("%s", payload)
