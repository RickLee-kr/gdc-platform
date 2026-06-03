"""Field Added / Field Removed detection (Milestone 2 — read-only signals)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.schema_observation.models import (
    DRIFT_CATEGORY_FIELD_ADDED,
    DRIFT_CATEGORY_FIELD_REMOVED,
    DRIFT_STATUS_OPEN,
    StreamObservedSchema,
    StreamSchemaFieldDrift,
)

logger = logging.getLogger(__name__)


def schema_drift_detection_enabled() -> bool:
    return bool(settings.GDC_SCHEMA_OBSERVATION_ENABLED and settings.GDC_SCHEMA_DRIFT_DETECTION_ENABLED)


def _baseline_paths_from_row(baseline_json: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    raw = baseline_json if isinstance(baseline_json, dict) else {}
    paths = raw.get("paths")
    if not isinstance(paths, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for path, meta in paths.items():
        if not isinstance(path, str):
            continue
        if isinstance(meta, dict):
            typ = meta.get("type")
            out[path] = {"type": typ} if isinstance(typ, str) else {}
        else:
            out[path] = {}
    return out


def _serialize_baseline(paths: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "paths": {
            path: {"type": meta["type"]}
            for path, meta in paths.items()
            if isinstance(meta.get("type"), str)
        }
    }


def _baseline_min_runs() -> int:
    return max(1, int(settings.GDC_SCHEMA_BASELINE_MIN_RUNS))


def _baseline_min_events() -> int:
    return max(1, int(settings.GDC_SCHEMA_BASELINE_MIN_EVENTS))


def _added_confirm_runs() -> int:
    return max(1, int(settings.GDC_SCHEMA_DRIFT_ADDED_CONFIRM_RUNS))


def _removed_absent_runs() -> int:
    return max(1, int(settings.GDC_SCHEMA_DRIFT_REMOVED_ABSENT_RUNS))


def maybe_establish_baseline(row: StreamObservedSchema, observed_paths: dict[str, dict[str, Any]]) -> bool:
    """Copy observed paths into baseline once minimum observation volume is met."""

    if row.baseline_paths_json is not None:
        return False
    if int(row.observation_run_count or 0) < _baseline_min_runs():
        return False
    if int(row.total_events_observed or 0) < _baseline_min_events():
        return False
    if not observed_paths:
        return False

    now = datetime.now(timezone.utc)
    snapshot = {
        path: {"type": meta["type"]}
        for path, meta in observed_paths.items()
        if isinstance(meta.get("type"), str)
    }
    row.baseline_paths_json = _serialize_baseline(snapshot)
    row.baseline_established_at = now
    return True


def update_path_presence_streaks(
    observed_paths: dict[str, dict[str, Any]],
    batch_paths: dict[str, str],
) -> None:
    """Track consecutive observation runs with/without each path (for noise gates)."""

    batch_set = set(batch_paths.keys())
    for path, meta in observed_paths.items():
        if path in batch_set:
            meta["runs_since_seen"] = 0
            if "add_confirm_runs" in meta:
                meta["add_confirm_runs"] = int(meta.get("add_confirm_runs") or 0) + 1
        else:
            meta["runs_since_seen"] = int(meta.get("runs_since_seen") or 0) + 1
            meta["add_confirm_runs"] = 0


def ensure_pending_add_tracking(
    observed_paths: dict[str, dict[str, Any]],
    baseline_paths: dict[str, dict[str, Any]],
    batch_paths: dict[str, str],
) -> None:
    for path in batch_paths:
        if path in baseline_paths:
            continue
        entry = observed_paths.get(path)
        if entry is None:
            continue
        if "add_confirm_runs" not in entry:
            entry["add_confirm_runs"] = 0


def detect_field_changes(
    db: Session,
    *,
    stream_id: int,
    row: StreamObservedSchema,
    observed_paths: dict[str, dict[str, Any]],
    batch_paths: dict[str, str],
) -> list[StreamSchemaFieldDrift]:
    """Compare observed inventory to baseline; upsert open field_added / field_removed findings."""

    if not schema_drift_detection_enabled():
        return []

    baseline_paths = _baseline_paths_from_row(row.baseline_paths_json)
    if not baseline_paths:
        return []

    now = datetime.now(timezone.utc)
    emitted: list[StreamSchemaFieldDrift] = []

    for path in batch_paths:
        if path in baseline_paths:
            continue
        entry = observed_paths.get(path)
        if entry is None:
            continue
        if int(entry.get("add_confirm_runs") or 0) < _added_confirm_runs():
            continue
        finding = _upsert_open_drift(
            db,
            stream_id=stream_id,
            field_path=path,
            category=DRIFT_CATEGORY_FIELD_ADDED,
            now=now,
        )
        if finding is not None:
            emitted.append(finding)

    removed_threshold = _removed_absent_runs()
    for path in baseline_paths:
        entry = observed_paths.get(path)
        if entry is None:
            continue
        if int(entry.get("runs_since_seen") or 0) < removed_threshold:
            continue
        finding = _upsert_open_drift(
            db,
            stream_id=stream_id,
            field_path=path,
            category=DRIFT_CATEGORY_FIELD_REMOVED,
            now=now,
        )
        if finding is not None:
            emitted.append(finding)

    return emitted


def _upsert_open_drift(
    db: Session,
    *,
    stream_id: int,
    field_path: str,
    category: str,
    now: datetime,
) -> StreamSchemaFieldDrift | None:
    existing = db.execute(
        select(StreamSchemaFieldDrift).where(
            StreamSchemaFieldDrift.stream_id == stream_id,
            StreamSchemaFieldDrift.field_path == field_path,
            StreamSchemaFieldDrift.category == category,
        )
    ).scalar_one_or_none()

    if existing is None:
        row = StreamSchemaFieldDrift(
            stream_id=stream_id,
            field_path=field_path,
            category=category,
            status=DRIFT_STATUS_OPEN,
            first_detected_at=now,
            last_confirmed_at=now,
        )
        db.add(row)
        return row

    if existing.status != DRIFT_STATUS_OPEN:
        return None

    existing.last_confirmed_at = now
    return existing


def list_open_field_drifts(db: Session, stream_id: int) -> list[StreamSchemaFieldDrift]:
    return list(
        db.execute(
            select(StreamSchemaFieldDrift)
            .where(
                StreamSchemaFieldDrift.stream_id == stream_id,
                StreamSchemaFieldDrift.status == DRIFT_STATUS_OPEN,
            )
            .order_by(StreamSchemaFieldDrift.category, StreamSchemaFieldDrift.field_path)
        ).scalars()
    )


def build_field_drifts_read_model(
    *,
    stream_id: int,
    row: StreamObservedSchema | None,
    findings: list[StreamSchemaFieldDrift],
) -> dict[str, Any]:
    baseline_paths = _baseline_paths_from_row(row.baseline_paths_json if row is not None else None)
    return {
        "stream_id": stream_id,
        "drift_detection_enabled": schema_drift_detection_enabled(),
        "baseline_established": row.baseline_established_at is not None if row is not None else False,
        "baseline_established_at": row.baseline_established_at if row is not None else None,
        "baseline_path_count": len(baseline_paths),
        "findings": [
            {
                "id": f.id,
                "field_path": f.field_path,
                "category": f.category,
                "status": f.status,
                "first_detected_at": f.first_detected_at,
                "last_confirmed_at": f.last_confirmed_at,
            }
            for f in findings
        ],
        "finding_count": len(findings),
    }

