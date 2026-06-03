"""Record and read per-Stream observed schema from extracted events."""

from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.schema_observation.models import StreamObservedSchema
from app.schema_observation.path_walker import collect_paths_from_events, merge_inferred_types

logger = logging.getLogger(__name__)


def schema_observation_enabled() -> bool:
    return bool(settings.GDC_SCHEMA_OBSERVATION_ENABLED)


def _paths_from_row(paths_json: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    raw = paths_json if isinstance(paths_json, dict) else {}
    paths = raw.get("paths")
    if not isinstance(paths, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for path, meta in paths.items():
        if not isinstance(path, str) or not isinstance(meta, dict):
            continue
        typ = meta.get("type")
        if isinstance(typ, str):
            out[path] = {"type": typ, "observation_count": int(meta.get("observation_count") or 0)}
    return out


def _serialize_paths(paths: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {"paths": deepcopy(paths)}


def merge_path_inventories(
    existing: dict[str, dict[str, Any]],
    batch_paths: dict[str, str],
    *,
    events_in_batch: int,
) -> dict[str, dict[str, Any]]:
    merged = deepcopy(existing)
    for path, typ in batch_paths.items():
        entry = merged.get(path)
        if entry is None:
            merged[path] = {"type": typ, "observation_count": events_in_batch}
        else:
            entry["type"] = merge_inferred_types(str(entry.get("type")), typ)
            entry["observation_count"] = int(entry.get("observation_count") or 0) + events_in_batch
    return merged


def observe_extracted_events(
    db: Session,
    stream_id: int,
    events: list[Any],
) -> None:
    """Merge schema paths from extracted events into the Stream observed schema store.

    Non-blocking: callers should catch exceptions. No-op when disabled or events empty.
    """

    if not schema_observation_enabled() or not events:
        return

    max_events = max(1, int(settings.GDC_SCHEMA_OBSERVATION_MAX_EVENTS_PER_RUN))
    max_paths = max(100, int(settings.GDC_SCHEMA_OBSERVATION_MAX_PATHS))
    max_depth = max(4, int(settings.GDC_SCHEMA_OBSERVATION_MAX_DEPTH))

    sample = [ev for ev in events if isinstance(ev, dict)][:max_events]
    if not sample:
        return

    batch_paths = collect_paths_from_events(
        sample,
        max_depth=max_depth,
        max_paths=max_paths,
        max_events=max_events,
    )
    if not batch_paths:
        return

    now = datetime.now(timezone.utc)
    row = db.get(StreamObservedSchema, stream_id)
    if row is None:
        row = StreamObservedSchema(
            stream_id=stream_id,
            paths_json=_serialize_paths(
                {p: {"type": t, "observation_count": len(sample)} for p, t in batch_paths.items()}
            ),
            total_events_observed=len(sample),
            observation_run_count=1,
            last_observation_at=now,
        )
        db.add(row)
        return

    existing_paths = _paths_from_row(row.paths_json)
    merged_paths = merge_path_inventories(existing_paths, batch_paths, events_in_batch=len(sample))
    row.paths_json = _serialize_paths(merged_paths)
    row.total_events_observed = int(row.total_events_observed or 0) + len(sample)
    row.observation_run_count = int(row.observation_run_count or 0) + 1
    row.last_observation_at = now
    row.updated_at = now


def get_observed_schema_row(db: Session, stream_id: int) -> StreamObservedSchema | None:
    return db.get(StreamObservedSchema, stream_id)


def build_observed_schema_read_model(
    *,
    stream_id: int,
    row: StreamObservedSchema | None,
) -> dict[str, Any]:
    paths_map = _paths_from_row(row.paths_json if row is not None else None)
    entries = [
        {"path": path, "type": meta["type"], "observation_count": meta.get("observation_count", 0)}
        for path, meta in sorted(paths_map.items(), key=lambda item: item[0])
    ]
    return {
        "stream_id": stream_id,
        "observation_enabled": schema_observation_enabled(),
        "paths": entries,
        "path_count": len(entries),
        "total_events_observed": int(row.total_events_observed) if row is not None else 0,
        "observation_run_count": int(row.observation_run_count) if row is not None else 0,
        "last_observation_at": row.last_observation_at if row is not None else None,
        "updated_at": row.updated_at if row is not None else None,
    }
