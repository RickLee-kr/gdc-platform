"""StreamRunner — coordinates pipeline for HTTP (and future DB/webhook) streams."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.checkpoints.service import CheckpointService
from app.delivery.syslog_sender import SyslogSender
from app.delivery.webhook_sender import WebhookSender
from app.destinations.adapters.registry import DestinationAdapterRegistry
from app.sources.adapters.registry import SourceAdapterRegistry
from app.formatters.message_prefix import MessagePrefixResolveContext, build_message_prefix_context
from app.enrichers.enrichment_engine import apply_enrichments
from app.mappers.mapper import apply_mappings
from app.parsers.event_extractor import extract_events
from app.pollers.http_poller import HttpPoller
from app.rate_limit.destination_limiter import DestinationRateLimiter
from app.rate_limit.source_limiter import SourceRateLimiter
from app.logs.models import DeliveryLog
from app.routes.repository import disable_route
from app.runtime.stream_context import StreamContext
from app.streams.repository import update_stream_status
from app.runners.base import BaseRunner

logger = logging.getLogger(__name__)


def _replay_iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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


@dataclass(slots=True)
class StreamRunOptions:
    """Per-invocation flags (do not store on the runner instance — concurrent streams may share one runner)."""

    persist_checkpoint: bool = True
    dry_run: bool = False
    replay_start: datetime | None = None
    replay_end: datetime | None = None


@dataclass
class FanOutOutcome:
    """Result of route fan-out for one batch — drives checkpoint trace semantics."""

    successful_events: list[dict[str, Any]]
    log_continue_failed_route_ids: tuple[int, ...] = field(default_factory=tuple)


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
        self.source_registry = SourceAdapterRegistry(http_poller=self.poller)
        _syslog = syslog_sender or SyslogSender()
        _webhook = webhook_sender or WebhookSender()
        self.syslog_sender = _syslog
        self.webhook_sender = _webhook
        self.destination_registry = DestinationAdapterRegistry(syslog_sender=_syslog, webhook_sender=_webhook)
        self.source_limiter = source_limiter or SourceRateLimiter()
        self.destination_limiter = destination_limiter or DestinationRateLimiter()
        self.checkpoint_service = checkpoint_service or CheckpointService()
        self._active_db: Session | None = None
        self._run_id: str | None = None
        self._connector_id: int | None = None

    def run(self, stream: Any, db: Session | None = None) -> dict[str, Any]:
        """Execute one stream cycle.

        The argument may be a stream object or dict that contains at least:
        ``id``, ``source_config``, ``stream_config``, ``routes``.

        Transaction boundary when ``db`` is provided:
        - ``_persist_delivery_log()`` only stages rows via ``db.add()``.
        - Success/partial-failure path is committed once here at run end.
        - Exception path rolls back, emits ``run_failed`` to logger, and re-raises.

        Returns a summary dict (API / observability); raises on exception path after rollback.
        """

        runtime_stream = stream.stream if isinstance(stream, StreamContext) else stream
        runtime_checkpoint = stream.checkpoint if isinstance(stream, StreamContext) else None
        self._active_db = db
        should_commit = False

        stream_id = int(_get(runtime_stream, "id"))
        lock = self._get_lock(stream_id)
        lock_acquired = lock.acquire(blocking=False)

        if isinstance(stream, StreamContext):
            run_opts = StreamRunOptions(
                persist_checkpoint=stream.persist_checkpoint,
                dry_run=stream.dry_run,
                replay_start=stream.replay_start,
                replay_end=stream.replay_end,
            )
        else:
            run_opts = StreamRunOptions()

        summary: dict[str, Any] = {
            "stream_id": stream_id,
            "outcome": "completed",
            "extracted_event_count": None,
            "mapped_event_count": None,
            "enriched_event_count": None,
            "delivered_batch_event_count": None,
            "checkpoint_updated": False,
            "transaction_committed": False,
            "message": None,
            "run_id": None,
            "dry_run": run_opts.dry_run,
            "skipped_delivery_count": None,
        }

        try:
            if not lock_acquired:
                self._emit_obs(
                    {"stage": "run_skip", "stream_id": stream_id, "skip_reason": "lock_held", "message": "stream already running"}
                )
                summary["outcome"] = "skipped_lock"
                summary["message"] = "stream already running"
                summary["run_id"] = None
                return summary

            self._run_id = str(uuid.uuid4())
            summary["run_id"] = self._run_id
            conn_raw = _get(runtime_stream, "connector_id")
            self._connector_id = int(conn_raw) if conn_raw is not None else None

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
                checkpoint_before_snapshot: dict[str, Any] | None = deepcopy(checkpoint) if checkpoint is not None else None
                self._emit_obs(
                    {
                        "stage": "checkpoint_resolved",
                        "stream_id": stream_id,
                        "checkpoint_type": checkpoint_type,
                        "has_checkpoint_payload": checkpoint is not None,
                    }
                )
                self._log(
                    {
                        "stage": "run_started",
                        "stream_id": stream_id,
                        "message": "stream run started",
                        "checkpoint_type": checkpoint_type,
                        "checkpoint_before": checkpoint_before_snapshot,
                    }
                )
                events, enriched_events, tx_stats = self._collect_and_transform_events(
                    runtime_stream=runtime_stream,
                    checkpoint=checkpoint,
                    stream_id=stream_id,
                    run_opts=run_opts,
                )
                summary["extracted_event_count"] = tx_stats.get("extracted_count")
                summary["mapped_event_count"] = tx_stats.get("mapped_count")
                summary["enriched_event_count"] = tx_stats.get("enriched_count")

                if not events:
                    self._emit_obs(
                        {
                            "stage": "no_events",
                            "stream_id": stream_id,
                            "message": "No new events extracted",
                        }
                    )
                    summary["outcome"] = "no_events"
                    summary["message"] = "No new events extracted"
                    summary["delivered_batch_event_count"] = 0
                    self._log(
                        {
                            "stage": "run_complete",
                            "stream_id": stream_id,
                            "input_events": 0,
                            "mapped_events": tx_stats.get("mapped_count"),
                            "success_events": 0,
                            "extracted_event_count": tx_stats.get("extracted_count"),
                            "mapped_event_count": tx_stats.get("mapped_count"),
                            "delivered_event_count": 0,
                            "checkpoint_before": checkpoint_before_snapshot,
                            "checkpoint_after": None,
                            "checkpoint_type": checkpoint_type,
                            "checkpoint_updated": False,
                            "processed_events": 0,
                            "delivered_events": 0,
                            "failed_events": 0,
                            "partial_success": False,
                            "update_reason": "no_events_extracted",
                            "retry_pending": False,
                        }
                    )
                    should_commit = True
                elif run_opts.dry_run:
                    summary["delivered_batch_event_count"] = 0
                    summary["skipped_delivery_count"] = len(enriched_events)
                    summary["outcome"] = "dry_run"
                    summary["message"] = "Dry run: destination delivery skipped"
                    processed_events = len(events)
                    delivered_events = 0
                    failed_events = 0
                    partial_success = False
                    checkpoint_after_snapshot: dict[str, Any] | None = None
                    self._log(
                        {
                            "stage": "run_complete",
                            "stream_id": stream_id,
                            "input_events": len(events),
                            "mapped_events": tx_stats.get("mapped_count"),
                            "success_events": 0,
                            "extracted_event_count": tx_stats.get("extracted_count"),
                            "mapped_event_count": tx_stats.get("mapped_count"),
                            "delivered_event_count": 0,
                            "checkpoint_before": checkpoint_before_snapshot,
                            "checkpoint_after": checkpoint_after_snapshot,
                            "checkpoint_type": checkpoint_type,
                            "checkpoint_updated": False,
                            "processed_events": processed_events,
                            "delivered_events": 0,
                            "failed_events": 0,
                            "partial_success": False,
                            "update_reason": "dry_run_no_delivery",
                            "retry_pending": False,
                        }
                    )
                    should_commit = True
                else:
                    fan_out = self._fan_out(runtime_stream, enriched_events)
                    successful_events = fan_out.successful_events
                    summary["delivered_batch_event_count"] = len(successful_events) if successful_events else 0

                    processed_events = len(events)
                    delivered_events = len(successful_events)
                    failed_events = max(0, processed_events - delivered_events)
                    partial_success = bool(successful_events) and (
                        len(fan_out.log_continue_failed_route_ids) > 0 or delivered_events < processed_events
                    )

                    checkpoint_after_snapshot = None
                    if successful_events:
                        cand = successful_events[-1]
                        cand_preview = list(cand.keys())[:40] if isinstance(cand, dict) else None
                        self._emit_obs(
                            {
                                "stage": "checkpoint_candidate",
                                "stream_id": stream_id,
                                "checkpoint_type": checkpoint_type,
                                "last_event_keys_preview": cand_preview,
                            }
                        )
                        if run_opts.persist_checkpoint:
                            update_reason = (
                                "partial_delivery_success"
                                if fan_out.log_continue_failed_route_ids
                                else "full_delivery_success"
                            )
                            checkpoint_after_snapshot = self._update_checkpoint_after_success(
                                db=db,
                                stream_id=stream_id,
                                checkpoint_type=checkpoint_type,
                                successful_events=successful_events,
                                checkpoint_before=checkpoint_before_snapshot,
                                processed_events=processed_events,
                                delivered_events=delivered_events,
                                failed_events=failed_events,
                                partial_success=partial_success,
                                update_reason=update_reason,
                                log_continue_failed_route_ids=fan_out.log_continue_failed_route_ids,
                            )
                            self._emit_obs(
                                {"stage": "checkpoint_update_staged", "stream_id": stream_id, "checkpoint_type": checkpoint_type}
                            )
                            summary["checkpoint_updated"] = True

                    complete_reason = (
                        "skipped_due_to_failure"
                        if not successful_events
                        else ("partial_delivery_success" if partial_success else "full_delivery_success")
                    )
                    retry_pending = processed_events > 0 and delivered_events == 0 and not successful_events

                    self._log(
                        {
                            "stage": "run_complete",
                            "stream_id": stream_id,
                            "input_events": len(events),
                            "mapped_events": tx_stats.get("mapped_count"),
                            "success_events": len(successful_events),
                            "extracted_event_count": tx_stats.get("extracted_count"),
                            "mapped_event_count": tx_stats.get("mapped_count"),
                            "delivered_event_count": len(successful_events),
                            "checkpoint_before": checkpoint_before_snapshot,
                            "checkpoint_after": checkpoint_after_snapshot,
                            "checkpoint_type": checkpoint_type,
                            "checkpoint_updated": bool(successful_events and run_opts.persist_checkpoint),
                            "processed_events": processed_events,
                            "delivered_events": delivered_events,
                            "failed_events": failed_events,
                            "partial_success": partial_success if successful_events else False,
                            "update_reason": complete_reason,
                            "retry_pending": retry_pending,
                        }
                    )
                    should_commit = True
        except Exception as exc:
            if db is not None and hasattr(db, "rollback"):
                try:
                    db.rollback()
                except Exception:  # pragma: no cover - defensive safety path
                    logger.exception("failed to rollback after stream runner exception", extra={"stream_id": stream_id})
            self._emit_obs(
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
                    self._commit_if_needed(db, stream_id=stream_id)
                    summary["transaction_committed"] = db is not None
            finally:
                self._active_db = None
                self._run_id = None
                self._connector_id = None
                if lock_acquired:
                    lock.release()

        return summary

    def _fan_out(self, stream: Any, events: list[dict[str, Any]]) -> FanOutOutcome:
        """Send events to all enabled routes and return globally successful events."""

        stream_id = int(_get(stream, "id"))
        routes = list(_get(stream, "routes", []) or [])
        if not routes:
            self._emit_obs({"stage": "pipeline_fan_out", "stream_id": stream_id, "detail": "no_routes_configured"})
            return FanOutOutcome(successful_events=[])
        if not events:
            self._emit_obs({"stage": "pipeline_fan_out", "stream_id": stream_id, "detail": "no_events_extracted"})
            return FanOutOutcome(successful_events=[])

        self._log(
            {
                "stage": "route",
                "stream_id": stream_id,
                "message": "route fan-out starting",
                "configured_route_count": len(routes),
            }
        )

        all_required_routes_succeeded = True
        saw_actionable_route = False
        log_continue_failed_route_ids: list[int] = []

        for route in routes:
            route_id = int(_get(route, "id", 0))
            failure_policy = str(_get(route, "failure_policy", "LOG_AND_CONTINUE")).upper()
            if not bool(_get(route, "enabled", True)):
                self._log(
                    {
                        "stage": "route_skip",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "skip_reason": "route_disabled",
                        "message": "route_disabled",
                    }
                )
                continue

            destination = _get(route, "destination", {}) or {}
            destination_id = _get(destination, "id")
            if not bool(_get(destination, "enabled", True)):
                self._log(
                    {
                        "stage": "route_skip",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "destination_id": destination_id,
                        "skip_reason": "destination_disabled",
                        "message": "destination_disabled",
                    }
                )
                continue

            saw_actionable_route = True
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

            prefix_context = self._prefix_delivery_context(stream, route)

            try:
                send_started = time.monotonic()
                self._send_to_destination(
                    destination_type,
                    events,
                    destination_config,
                    formatter_override=formatter_override,
                    prefix_context=prefix_context,
                )
                latency_ms = max(0, int((time.monotonic() - send_started) * 1000))
                first_keys = list(events[0].keys())[:24] if events and isinstance(events[0], dict) else []
                self._log(
                    {
                        "stage": "route_send_success",
                        "stream_id": stream_id,
                        "route_id": route_id,
                        "destination_id": _get(destination, "id"),
                        "destination_type": destination_type,
                        "event_count": len(events),
                        "first_event_keys_preview": first_keys,
                        "latency_ms": latency_ms,
                    }
                )
            except Exception as exc:
                latency_ms = max(0, int((time.monotonic() - send_started) * 1000))
                if failure_policy == "LOG_AND_CONTINUE":
                    log_continue_failed_route_ids.append(route_id)
                recovered = self._apply_failure_policy(stream, route, events, exc, attempt_latency_ms=latency_ms)
                if not recovered:
                    all_required_routes_succeeded = False

        if not saw_actionable_route:
            self._emit_obs(
                {
                    "stage": "pipeline_no_actionable_routes",
                    "stream_id": stream_id,
                    "detail": "no_destinations_resolved_for_delivery",
                }
            )
            return FanOutOutcome(successful_events=[])

        if all_required_routes_succeeded:
            return FanOutOutcome(
                successful_events=deepcopy(events),
                log_continue_failed_route_ids=tuple(log_continue_failed_route_ids),
            )
        return FanOutOutcome(successful_events=[])

    def _prefix_delivery_context(self, stream: Any, route: Any) -> MessagePrefixResolveContext:
        stream_id = int(_get(stream, "id", 0))
        stream_name = str(_get(stream, "name", "") or "")
        route_id = int(_get(route, "id", 0))
        destination = _get(route, "destination", {}) or {}
        dest_name = str(_get(destination, "name", "") or "")
        dest_type = str(_get(destination, "destination_type", "") or "")
        return build_message_prefix_context(
            stream_name=stream_name,
            stream_id=stream_id,
            destination_name=dest_name,
            destination_type=dest_type,
            route_id=route_id,
        )

    def _send_to_destination(
        self,
        destination_type: str,
        events: list[dict[str, Any]],
        destination_config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        *,
        prefix_context: MessagePrefixResolveContext | None = None,
    ) -> None:
        self.destination_registry.get(destination_type).send(
            events,
            destination_config,
            formatter_override=formatter_override,
            prefix_context=prefix_context,
        )

    def _apply_failure_policy(
        self,
        stream: Any,
        route: Any,
        events: list[dict[str, Any]],
        error: Exception,
        *,
        attempt_latency_ms: int | None = None,
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
                "latency_ms": attempt_latency_ms,
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
            route_fc_retry = _get(route, "formatter_config_json")
            formatter_retry: dict[str, Any] | None = None
            if isinstance(route_fc_retry, dict) and route_fc_retry:
                formatter_retry = route_fc_retry
            if not events:
                return False

            prefix_context = self._prefix_delivery_context(stream, route)

            last_exc: Exception | None = None
            for idx in range(retry_count):
                try:
                    rs = time.monotonic()
                    self._send_to_destination(
                        destination_type,
                        events,
                        destination_config,
                        formatter_override=formatter_retry,
                        prefix_context=prefix_context,
                    )
                    rlat = max(0, int((time.monotonic() - rs) * 1000))
                    self._log(
                        {
                            "stage": "route_retry_success",
                            "stream_id": stream_id,
                            "route_id": route_id,
                            "attempt": idx + 1,
                            "retry_count": idx + 1,
                            "latency_ms": rlat,
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
        self,
        *,
        runtime_stream: Any,
        checkpoint: dict[str, Any] | None,
        stream_id: int,
        run_opts: StreamRunOptions,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
        source_config = dict(_get(runtime_stream, "source_config", {}) or {})
        stream_config = dict(_get(runtime_stream, "stream_config", {}) or {})

        fetch_checkpoint: dict[str, Any] | None
        if isinstance(checkpoint, dict):
            fetch_checkpoint = dict(checkpoint)
        else:
            fetch_checkpoint = None

        if run_opts.replay_start is not None and run_opts.replay_end is not None:
            iso_s = _replay_iso_utc(run_opts.replay_start)
            iso_e = _replay_iso_utc(run_opts.replay_end)
            stream_config["gdc_replay_start_iso"] = iso_s
            stream_config["gdc_replay_end_iso"] = iso_e
            fc = dict(fetch_checkpoint or {})
            fc["gdc_backfill_start_iso"] = iso_s
            fc["gdc_backfill_end_iso"] = iso_e
            fetch_checkpoint = fc

        self._emit_obs({"stage": "http_fetch_start", "stream_id": stream_id})
        source_type = str(_get(runtime_stream, "source_type", "HTTP_API_POLLING")).strip().upper()
        t_fetch = time.monotonic()
        raw_response = self.source_registry.get(source_type).fetch(source_config, stream_config, fetch_checkpoint)
        fetch_ms = max(0, int((time.monotonic() - t_fetch) * 1000))
        self._emit_obs(
            {
                "stage": "http_fetch_complete",
                "stream_id": stream_id,
                "raw_type": type(raw_response).__name__,
            }
        )
        self._log(
            {
                "stage": "source_fetch",
                "stream_id": stream_id,
                "message": "source fetch completed",
                "latency_ms": fetch_ms,
                "source_type": source_type,
            }
        )
        events = extract_events(
            raw_response,
            _get(runtime_stream, "event_array_path", _get(stream_config, "event_array_path")),
            _get(runtime_stream, "event_root_path", _get(stream_config, "event_root_path")),
        )
        self._log(
            {
                "stage": "parse",
                "stream_id": stream_id,
                "message": "events extracted",
                "extracted_event_count": len(events),
            }
        )
        if not events:
            return [], [], {"extracted_count": 0, "mapped_count": 0, "enriched_count": 0}

        mapped_events = apply_mappings(events, _get(runtime_stream, "field_mappings", {}) or {})
        self._log(
            {
                "stage": "mapping",
                "stream_id": stream_id,
                "message": "mapping applied",
                "mapped_event_count": len(mapped_events),
            }
        )
        enriched_events = apply_enrichments(
            mapped_events,
            _get(runtime_stream, "enrichment", {}) or {},
            override_policy=str(_get(runtime_stream, "override_policy", "KEEP_EXISTING")),
        )
        if len(events) == len(enriched_events):
            s3_meta_keys = ("s3_bucket", "s3_key", "s3_last_modified", "s3_etag", "s3_size")
            db_meta_keys = ("gdc_db_watermark", "gdc_db_order_value")
            remote_meta_keys = (
                "remote_path",
                "remote_mtime",
                "remote_size",
                "gdc_remote_path",
                "gdc_remote_mtime",
                "gdc_remote_size",
                "gdc_remote_offset",
                "gdc_remote_hash",
                "gdc_remote_protocol",
                "gdc_remote_host",
            )
            for idx, enriched in enumerate(enriched_events):
                raw_ev = events[idx]
                if not isinstance(raw_ev, dict) or not isinstance(enriched, dict):
                    continue
                for mk in s3_meta_keys:
                    if mk in raw_ev and mk not in enriched:
                        enriched[mk] = raw_ev[mk]
                for mk in db_meta_keys:
                    if mk in raw_ev and mk not in enriched:
                        enriched[mk] = raw_ev[mk]
                for mk in remote_meta_keys:
                    if mk in raw_ev and mk not in enriched:
                        enriched[mk] = raw_ev[mk]
        self._log(
            {
                "stage": "enrichment",
                "stream_id": stream_id,
                "message": "enrichment applied",
                "enriched_event_count": len(enriched_events),
            }
        )
        stats = {
            "extracted_count": len(events),
            "mapped_count": len(mapped_events),
            "enriched_count": len(enriched_events),
        }
        self._emit_obs(
            {
                "stage": "pipeline_transform",
                "stream_id": stream_id,
                "extracted_event_count": stats["extracted_count"],
                "mapped_event_count": stats["mapped_count"],
                "enriched_event_count": stats["enriched_count"],
            }
        )
        return events, enriched_events, stats

    def _update_checkpoint_after_success(
        self,
        *,
        db: Session | None,
        stream_id: int,
        checkpoint_type: str,
        successful_events: list[dict[str, Any]],
        checkpoint_before: dict[str, Any] | None,
        processed_events: int,
        delivered_events: int,
        failed_events: int,
        partial_success: bool,
        update_reason: str,
        log_continue_failed_route_ids: tuple[int, ...],
    ) -> dict[str, Any] | None:
        correlated = [
            {"route_id": int(rid), "failure_kind": "log_and_continue_absorbed"} for rid in log_continue_failed_route_ids
        ]
        if db is not None:
            last_ev = deepcopy(successful_events[-1])
            checkpoint_value: dict[str, Any] = {"last_success_event": last_ev}
            if isinstance(last_ev, dict):
                sk = last_ev.get("s3_key")
                slm = last_ev.get("s3_last_modified")
                etag = last_ev.get("s3_etag")
                if sk is not None:
                    checkpoint_value["last_processed_key"] = sk
                if slm is not None:
                    checkpoint_value["last_processed_last_modified"] = slm
                if etag is not None:
                    checkpoint_value["last_processed_etag"] = etag
                wm = last_ev.get("gdc_db_watermark")
                lo = last_ev.get("gdc_db_order_value")
                if wm is not None:
                    checkpoint_value["last_processed_db_watermark"] = wm
                if lo is not None:
                    checkpoint_value["last_processed_db_order"] = lo
                rp = last_ev.get("remote_path") or last_ev.get("gdc_remote_path")
                rmt = last_ev.get("remote_mtime") or last_ev.get("gdc_remote_mtime")
                rsz = last_ev.get("remote_size")
                if rsz is None:
                    rsz = last_ev.get("gdc_remote_size")
                roff = last_ev.get("gdc_remote_offset")
                rhash = last_ev.get("gdc_remote_hash")
                if rp is not None:
                    checkpoint_value["last_processed_key"] = rp
                    checkpoint_value["last_processed_file"] = rp
                if rmt is not None:
                    checkpoint_value["last_processed_last_modified"] = rmt
                    checkpoint_value["last_processed_mtime"] = rmt
                if rsz is not None:
                    checkpoint_value["last_processed_size"] = rsz
                if roff is not None:
                    checkpoint_value["last_processed_offset"] = roff
                if rhash is not None:
                    checkpoint_value["last_processed_hash"] = rhash
            after = self.checkpoint_service.update_checkpoint_after_success(
                db=db,
                stream_id=stream_id,
                checkpoint_type=checkpoint_type,
                checkpoint_value=checkpoint_value,
            )
            self._log(
                {
                    "stage": "checkpoint_update",
                    "stream_id": stream_id,
                    "message": "checkpoint updated after successful destination delivery",
                    "checkpoint_type": checkpoint_type,
                    "checkpoint_before": deepcopy(checkpoint_before) if checkpoint_before is not None else None,
                    "checkpoint_after": deepcopy(after) if isinstance(after, dict) else after,
                    "processed_events": processed_events,
                    "delivered_events": delivered_events,
                    "failed_events": failed_events,
                    "partial_success": partial_success,
                    "update_reason": update_reason,
                    "correlated_route_failures": correlated,
                }
            )
            return deepcopy(after) if isinstance(after, dict) else None
        self.checkpoint_service.update(stream_id, successful_events[-1])
        return None

    def _commit_if_needed(self, db: Session | None, *, stream_id: int | None = None) -> None:
        if db is not None and hasattr(db, "commit"):
            db.commit()
            self._emit_obs({"stage": "transaction_committed", "stream_id": stream_id})

    @classmethod
    def _get_lock(cls, stream_id: int) -> threading.Lock:
        with cls._locks_guard:
            if stream_id not in cls._locks:
                cls._locks[stream_id] = threading.Lock()
            return cls._locks[stream_id]

    def _emit_obs(self, payload: dict[str, Any]) -> None:
        """Structured runtime observability (logger only; not persisted to delivery_logs)."""

        logger.info("%s", payload)

    def _log(self, payload: dict[str, Any]) -> None:
        """Emit structured logs as dict payload."""

        enriched: dict[str, Any] = dict(payload)
        if self._run_id:
            enriched["run_id"] = self._run_id
        if self._connector_id is not None:
            enriched["connector_id"] = self._connector_id
        logger.info("%s", enriched)
        self._persist_delivery_log(enriched)

    def _persist_delivery_log(self, payload: dict[str, Any]) -> None:
        """Persist selected runtime log stages into delivery_logs when DB exists."""

        if self._active_db is None or not hasattr(self._active_db, "add"):
            return

        stage = str(payload.get("stage", "")).strip()
        if stage not in {
            "run_started",
            "source_fetch",
            "parse",
            "mapping",
            "enrichment",
            "route",
            "route_send_success",
            "route_send_failed",
            "route_retry_success",
            "route_retry_failed",
            "source_rate_limited",
            "destination_rate_limited",
            "route_skip",
            "route_unknown_failure_policy",
            "checkpoint_update",
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
        elif stage == "run_started":
            status = "OK"
        elif stage in {"run_complete", "checkpoint_update"}:
            status = "COMPLETED"

        message = str(payload.get("message") or stage)
        stream_id = payload.get("stream_id")
        route_id = payload.get("route_id")
        destination_id = payload.get("destination_id")
        connector_raw = payload.get("connector_id")
        run_id_raw = payload.get("run_id")
        lat_raw = payload.get("latency_ms")
        latency_ms: int | None = None
        if isinstance(lat_raw, int) and lat_raw >= 0:
            latency_ms = lat_raw
        elif lat_raw is not None:
            try:
                latency_ms = max(0, int(lat_raw))
            except (TypeError, ValueError):
                latency_ms = None

        retry_count = 0
        if stage == "route_retry_success":
            retry_count = int(payload.get("attempt") or payload.get("retry_count") or 0)
        elif stage == "route_retry_failed":
            retry_count = int(payload.get("retry_count") or 0)

        payload_sample = deepcopy(payload)

        row = DeliveryLog(
            connector_id=int(connector_raw) if connector_raw is not None else None,
            stream_id=int(stream_id) if stream_id is not None else None,
            route_id=int(route_id) if route_id is not None else None,
            destination_id=int(destination_id) if destination_id is not None else None,
            stage=stage,
            level=level,
            status=status,
            message=message,
            payload_sample=payload_sample if isinstance(payload_sample, dict) else {},
            retry_count=retry_count,
            http_status=None,
            latency_ms=latency_ms,
            error_code=error_code,
            run_id=str(run_id_raw) if run_id_raw else None,
        )
        try:
            self._active_db.add(row)
        except Exception:  # pragma: no cover - defensive safety path
            logger.exception("failed to persist delivery log", extra={"payload": payload})
