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
from app.logs.models import DeliveryLog
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


def _effective_destination_rate_limit_json(route: Any, destination: Any) -> dict[str, Any]:
    """Route.rate_limit_json overrides Destination.rate_limit_json when non-empty."""

    route_rl = _get(route, "rate_limit_json")
    dest_rl = _get(destination, "rate_limit_json")
    if isinstance(route_rl, dict) and route_rl:
        return dict(route_rl)
    if isinstance(dest_rl, dict) and dest_rl:
        return dict(dest_rl)
    return {}


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

        Transaction boundary when ``db`` is provided:
        - ``_persist_delivery_log()`` only stages rows via ``db.add()``.
        - Success/partial-failure path is committed once here at run end.
        - Exception path rolls back, emits ``run_failed`` to logger, and re-raises.
        """

        runtime_stream = stream.stream if isinstance(stream, StreamContext) else stream
        runtime_checkpoint = stream.checkpoint if isinstance(stream, StreamContext) else None
        self._active_db = db
        should_commit = False

        stream_id = int(_get(runtime_stream, "id"))
        lock = self._get_lock(stream_id)
        lock_acquired = lock.acquire(blocking=False)

        try:
            if not lock_acquired:
                self._log({"stage": "run_skip", "stream_id": stream_id, "message": "stream already running"})
            else:
                if not self.source_limiter.allow(stream_id):
                    self._set_stream_status(runtime_stream, "RATE_LIMITED_SOURCE")
                    self._log(
                        {
                            "stage": "source_rate_limited",
                            "stream_id": stream_id,
                            "message": "source rate limited",
                        }
                    )
                    should_commit = True
                else:
                    checkpoint_type, checkpoint = self._resolve_checkpoint(
                        runtime_checkpoint=runtime_checkpoint,
                        db=db,
                        stream_id=stream_id,
                    )
                    events, enriched_events = self._collect_and_transform_events(
                        runtime_stream=runtime_stream,
                        checkpoint=checkpoint,
                    )
                    successful_events = self._fan_out(runtime_stream, enriched_events)

                    self._log(
                        {
                            "stage": "run_complete",
                            "stream_id": stream_id,
                            "input_events": len(events),
                            "success_events": len(successful_events),
                        }
                    )

                    if successful_events:
                        self._update_checkpoint_after_success(
                            db=db,
                            stream_id=stream_id,
                            checkpoint_type=checkpoint_type,
                            successful_events=successful_events,
                        )
                    should_commit = True
        except Exception as exc:
            if db is not None and hasattr(db, "rollback"):
                try:
                    db.rollback()
                except Exception:  # pragma: no cover - defensive safety path
                    logger.exception("failed to rollback after stream runner exception", extra={"stream_id": stream_id})
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
            try:
                if should_commit:
                    self._commit_if_needed(db)
            finally:
                self._active_db = None
                if lock_acquired:
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

            destination = _get(route, "destination", {}) or {}
            destination_id = _get(destination, "id")
            effective_rl = _effective_destination_rate_limit_json(route, destination)

            if not self.destination_limiter.allow(route_id, effective_rl):
                self._set_stream_status(stream, "RATE_LIMITED_DESTINATION")
                self._log(
                    {
                        "stage": "destination_rate_limited",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "destination_id": destination_id,
                        "message": "destination rate limited",
                    }
                )
                all_required_routes_succeeded = False
                continue

            destination_type = str(_get(destination, "destination_type", "")).upper()
            destination_config = _get(destination, "config", {}) or {}
            route_fc = _get(route, "formatter_config_json")
            formatter_override: dict[str, Any] | None = None
            if isinstance(route_fc, dict) and route_fc:
                formatter_override = route_fc

            try:
                self._send_to_destination(
                    destination_type,
                    events,
                    destination_config,
                    formatter_override=formatter_override,
                )
                self._log(
                    {
                        "stage": "route_send_success",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "destination_id": _get(destination, "id"),
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
        formatter_override: dict[str, Any] | None = None,
    ) -> None:
        if destination_type.startswith("SYSLOG"):
            self.syslog_sender.send(events, destination_config, formatter_override=formatter_override)
            return
        if destination_type == "WEBHOOK_POST":
            self.webhook_sender.send(events, destination_config, formatter_override=formatter_override)
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
                "destination_id": _get(_get(route, "destination", {}) or {}, "id"),
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

    def _resolve_checkpoint(
        self, *, runtime_checkpoint: Any, db: Session | None, stream_id: int
    ) -> tuple[str, dict[str, Any] | None]:
        checkpoint_type = "CUSTOM_FIELD"
        checkpoint = runtime_checkpoint
        if isinstance(runtime_checkpoint, dict) and "value" in runtime_checkpoint:
            checkpoint = runtime_checkpoint.get("value")
            checkpoint_type = str(runtime_checkpoint.get("type", "CUSTOM_FIELD"))

        if checkpoint is not None:
            return checkpoint_type, checkpoint

        if db is not None:
            db_checkpoint = self.checkpoint_service.get_checkpoint(db, stream_id)
            if isinstance(db_checkpoint, dict) and "value" in db_checkpoint:
                return str(db_checkpoint.get("type", "CUSTOM_FIELD")), db_checkpoint.get("value")
            return checkpoint_type, db_checkpoint

        return checkpoint_type, self.checkpoint_service.get_checkpoint_for_stream(stream_id)

    def _collect_and_transform_events(
        self, *, runtime_stream: Any, checkpoint: dict[str, Any] | None
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        source_config = _get(runtime_stream, "source_config", {}) or {}
        stream_config = _get(runtime_stream, "stream_config", {}) or {}

        raw_response = self.poller.fetch(source_config, stream_config, checkpoint)
        events = extract_events(raw_response, _get(stream_config, "event_array_path"))
        mapped_events = apply_mappings(events, _get(runtime_stream, "field_mappings", {}) or {})
        enriched_events = apply_enrichments(
            mapped_events,
            _get(runtime_stream, "enrichment", {}) or {},
            override_policy=str(_get(runtime_stream, "override_policy", "KEEP_EXISTING")),
        )
        return events, enriched_events

    def _update_checkpoint_after_success(
        self,
        *,
        db: Session | None,
        stream_id: int,
        checkpoint_type: str,
        successful_events: list[dict[str, Any]],
    ) -> None:
        if db is not None:
            checkpoint_value = {"last_success_event": deepcopy(successful_events[-1])}
            self.checkpoint_service.update_checkpoint_after_success(
                db=db,
                stream_id=stream_id,
                checkpoint_type=checkpoint_type,
                checkpoint_value=checkpoint_value,
            )
            return
        self.checkpoint_service.update(stream_id, successful_events[-1])

    @staticmethod
    def _commit_if_needed(db: Session | None) -> None:
        if db is not None and hasattr(db, "commit"):
            db.commit()

    @classmethod
    def _get_lock(cls, stream_id: int) -> threading.Lock:
        with cls._locks_guard:
            if stream_id not in cls._locks:
                cls._locks[stream_id] = threading.Lock()
            return cls._locks[stream_id]

    def _log(self, payload: dict[str, Any]) -> None:
        """Emit structured logs as dict payload."""

        logger.info("%s", payload)
        self._persist_delivery_log(payload)

    def _persist_delivery_log(self, payload: dict[str, Any]) -> None:
        """Persist selected runtime log stages into delivery_logs when DB exists."""

        if self._active_db is None or not hasattr(self._active_db, "add"):
            return

        stage = str(payload.get("stage", "")).strip()
        if stage not in {
            "route_send_success",
            "route_send_failed",
            "route_retry_success",
            "route_retry_failed",
            "source_rate_limited",
            "destination_rate_limited",
            "route_skip",
            "route_unknown_failure_policy",
            "run_complete",
        }:
            return

        level = "INFO"
        status = "OK"
        error_code = None
        if stage in {"route_send_failed", "route_retry_failed"}:
            level = "ERROR"
            status = "FAILED"
            error_code = str(payload.get("error_type")) if payload.get("error_type") else None
        elif stage == "source_rate_limited":
            level = "WARN"
            status = "RATE_LIMITED"
            error_code = "SOURCE_RATE_LIMITED"
        elif stage == "destination_rate_limited":
            level = "WARN"
            status = "RATE_LIMITED"
            error_code = "DESTINATION_RATE_LIMITED"
        elif stage == "route_skip":
            status = "SKIPPED"
        elif stage == "route_unknown_failure_policy":
            level = "ERROR"
            status = "FAILED"
            error_code = "UNKNOWN_FAILURE_POLICY"
        elif stage == "run_complete":
            status = "COMPLETED"

        message = str(payload.get("message") or stage)
        stream_id = payload.get("stream_id")
        route_id = payload.get("route_id")
        destination_id = payload.get("destination_id")
        payload_sample = deepcopy(payload)

        row = DeliveryLog(
            connector_id=None,
            stream_id=int(stream_id) if stream_id is not None else None,
            route_id=int(route_id) if route_id is not None else None,
            destination_id=int(destination_id) if destination_id is not None else None,
            stage=stage,
            level=level,
            status=status,
            message=message,
            payload_sample=payload_sample if isinstance(payload_sample, dict) else {},
            retry_count=0,
            http_status=None,
            latency_ms=None,
            error_code=error_code,
        )
        try:
            self._active_db.add(row)
        except Exception:  # pragma: no cover - defensive safety path
            logger.exception("failed to persist delivery log", extra={"payload": payload})
