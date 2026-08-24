"""Runtime restart recovery for Durable Delivery Queue (Phase 3/4).

Resumes undelivered queue items (WEBHOOK_POST, SYSLOG_TCP) after process
restart using the same claim/lease semantics and destination send path as
the live enqueue path.

Does not introduce a parallel HTTP / retry / recovery engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class QueueRecoverySummary:
    """Outcome of one recovery drain pass for a stream."""

    attempted: bool = False
    claimed: int = 0
    delivered: int = 0
    failed: int = 0
    stale_inflight_reclaimed: int = 0
    remaining_undelivered: int = 0
    checkpoint_advanced: bool = False
    skipped_reason: str | None = None
    recovered_item_ids: list[int] = field(default_factory=list)


def events_from_queue_payload(payload_json: Any) -> list[dict[str, Any]]:
    """Extract the event batch snapshot from a queue item payload."""

    if isinstance(payload_json, dict):
        events = payload_json.get("events")
        if isinstance(events, list):
            return [dict(item) for item in events if isinstance(item, dict)]
        # Single-event dict stored without envelope (normalize_queue_payload usually wraps).
        return [dict(payload_json)]
    if isinstance(payload_json, list):
        return [dict(item) for item in payload_json if isinstance(item, dict)]
    return []


def find_route_and_destination(
    runtime_stream: dict[str, Any],
    *,
    route_id: int,
    destination_id: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Locate route + destination dicts from a loaded runtime stream context."""

    routes = runtime_stream.get("routes") if isinstance(runtime_stream, dict) else None
    if not isinstance(routes, list):
        return None, None
    for route in routes:
        if not isinstance(route, dict):
            continue
        if int(route.get("id") or 0) != int(route_id):
            continue
        destination = route.get("destination")
        if not isinstance(destination, dict):
            return route, None
        if int(destination.get("id") or 0) != int(destination_id):
            # Failover may have retargeted destination_id; still return route and
            # look up destination by id across routes' destinations.
            return route, _destination_by_id(runtime_stream, destination_id)
        return route, destination
    return None, _destination_by_id(runtime_stream, destination_id)


def _destination_by_id(runtime_stream: dict[str, Any], destination_id: int) -> dict[str, Any] | None:
    routes = runtime_stream.get("routes") if isinstance(runtime_stream, dict) else None
    if not isinstance(routes, list):
        return None
    for route in routes:
        if not isinstance(route, dict):
            continue
        destination = route.get("destination")
        if isinstance(destination, dict) and int(destination.get("id") or 0) == int(destination_id):
            return destination
    return None
