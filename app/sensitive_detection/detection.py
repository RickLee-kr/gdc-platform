"""Sensitive field detection on enriched events (M5)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.schema_observation.models import (
    DRIFT_CATEGORY_FIELD_ADDED,
    DRIFT_STATUS_OPEN,
    StreamSchemaFieldDrift,
)
from app.schema_observation.path_walker import TYPE_STRING, collect_paths_from_events
from app.sensitive_detection.models import (
    FINDING_STATUS_OPEN,
    FINDING_STATUS_RESOLVED,
    StreamSensitiveFinding,
)
from app.sensitive_detection.path_rules import evaluate_field_name_rules, leaf_segment
from app.sensitive_detection.pattern_rules import evaluate_pattern_rules

logger = logging.getLogger(__name__)

_FORBIDDEN_FINDING_JSON_KEYS = frozenset({"value", "sample", "raw", "payload", "event"})


def sensitive_detection_enabled() -> bool:
    return bool(settings.GDC_SENSITIVE_DETECTION_ENABLED)


def _max_depth() -> int:
    return max(1, int(settings.GDC_SENSITIVE_DETECTION_MAX_DEPTH))


def _max_paths() -> int:
    return max(1, int(settings.GDC_SENSITIVE_DETECTION_MAX_PATHS))


def _max_events() -> int:
    return max(1, int(settings.GDC_SENSITIVE_DETECTION_MAX_EVENTS_PER_RUN))


def _confirm_runs() -> int:
    return max(1, int(settings.GDC_SENSITIVE_DETECTION_CONFIRM_RUNS))


def _sanitize_finding_json(
    *,
    matched_rule: str,
    matched_segment: str,
    inferred_type: str | None,
    detection_method: str,
    pattern: str | None = None,
    confirm_run_count: int,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "matched_rule": matched_rule,
        "matched_segment": matched_segment,
        "confirm_run_count": confirm_run_count,
    }
    if inferred_type:
        payload["inferred_type"] = inferred_type
    if pattern:
        payload["pattern"] = pattern
    if detection_method:
        payload["detection_method"] = detection_method
    for key in _FORBIDDEN_FINDING_JSON_KEYS:
        payload.pop(key, None)
    return payload


def collect_string_samples_from_events(
    events: list[Any],
    *,
    max_depth: int,
    max_paths: int,
    max_events: int,
) -> dict[str, str]:
    """First string sample per path across up to max_events events."""

    samples: dict[str, str] = {}

    def _walk(value: Any, path: str, depth: int) -> None:
        if len(samples) >= max_paths or depth > max_depth:
            return
        if isinstance(value, str):
            if path not in samples:
                samples[path] = value
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if not isinstance(key, str):
                    continue
                child_path = f"{path}.{key}" if path != "$" else f"$.{key}"
                _walk(child, child_path, depth + 1)
                if len(samples) >= max_paths:
                    return
        elif isinstance(value, list):
            array_path = f"{path}[]"
            for item in value[:3]:
                if isinstance(item, dict):
                    for key, child in item.items():
                        if not isinstance(key, str):
                            continue
                        _walk(child, f"{array_path}.{key}", depth + 1)
                else:
                    _walk(item, f"{array_path}[]", depth + 1)
                if len(samples) >= max_paths:
                    return

    for event in events[:max_events]:
        if not isinstance(event, dict):
            _walk(event, "$", 0)
            continue
        for key, value in event.items():
            if not isinstance(key, str):
                continue
            _walk(value, f"$.{key}", 0)
            if len(samples) >= max_paths:
                break
    return samples


def detect_hits_for_batch(
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Evaluate field-name and pattern rules for one run's enriched events."""

    if not events:
        return []

    batch_paths = collect_paths_from_events(
        events,
        max_depth=_max_depth(),
        max_paths=_max_paths(),
        max_events=_max_events(),
    )
    string_samples = collect_string_samples_from_events(
        events,
        max_depth=_max_depth(),
        max_paths=_max_paths(),
        max_events=_max_events(),
    )

    hits: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for field_path in sorted(batch_paths.keys()):
        inferred_type = batch_paths[field_path]
        for hit in evaluate_field_name_rules(field_path):
            key = (field_path, hit["sensitivity_class"])
            if key in seen:
                continue
            seen.add(key)
            hits.append(
                {
                    "field_path": field_path,
                    "inferred_type": inferred_type,
                    **hit,
                }
            )

        if inferred_type == TYPE_STRING:
            sample = string_samples.get(field_path)
            pattern_hit = evaluate_pattern_rules(
                field_path,
                inferred_type=inferred_type,
                sample_value=sample,
            )
            if pattern_hit is not None:
                key = (field_path, pattern_hit["sensitivity_class"])
                if key not in seen:
                    seen.add(key)
                    hits.append(
                        {
                            "field_path": field_path,
                            "inferred_type": inferred_type,
                            **pattern_hit,
                        }
                    )

    return hits


def _hit_key(hit: dict[str, Any]) -> tuple[str, str]:
    return (str(hit["field_path"]), str(hit["sensitivity_class"]))


def _aggregate_hits(hits: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """One entry per (field_path, sensitivity_class) per batch."""

    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for hit in hits:
        aggregated[_hit_key(hit)] = hit
    return aggregated


def _load_existing_findings_map(
    db: Session,
    *,
    stream_id: int,
    hit_keys: set[tuple[str, str]],
) -> dict[tuple[str, str], StreamSensitiveFinding]:
    if not hit_keys:
        return {}

    field_paths = {field_path for field_path, _ in hit_keys}
    sensitivity_classes = {sensitivity_class for _, sensitivity_class in hit_keys}
    rows = db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.stream_id == stream_id,
            StreamSensitiveFinding.field_path.in_(field_paths),
            StreamSensitiveFinding.sensitivity_class.in_(sensitivity_classes),
        )
    ).scalars()
    out: dict[tuple[str, str], StreamSensitiveFinding] = {}
    for row in rows:
        key = (row.field_path, row.sensitivity_class)
        if key in hit_keys:
            out[key] = row
    return out


def _load_related_drift_ids_map(
    db: Session,
    *,
    stream_id: int,
    field_paths: set[str],
) -> dict[str, int]:
    if not field_paths:
        return {}

    rows = db.execute(
        select(StreamSchemaFieldDrift.field_path, StreamSchemaFieldDrift.id).where(
            StreamSchemaFieldDrift.stream_id == stream_id,
            StreamSchemaFieldDrift.field_path.in_(field_paths),
            StreamSchemaFieldDrift.category == DRIFT_CATEGORY_FIELD_ADDED,
            StreamSchemaFieldDrift.status == DRIFT_STATUS_OPEN,
        )
    ).all()
    return {str(field_path): int(drift_id) for field_path, drift_id in rows}


def _upsert_sensitive_hits_batch(
    db: Session,
    *,
    stream_id: int,
    hits: list[dict[str, Any]],
    now: datetime,
) -> int:
    """Bulk upsert findings for one batch — two SELECTs plus batched writes."""

    aggregated = _aggregate_hits(hits)
    if not aggregated:
        return 0

    hit_keys = set(aggregated.keys())
    existing_map = _load_existing_findings_map(db, stream_id=stream_id, hit_keys=hit_keys)
    drift_map = _load_related_drift_ids_map(
        db,
        stream_id=stream_id,
        field_paths={field_path for field_path, _ in hit_keys},
    )

    upserted = 0
    new_rows: list[StreamSensitiveFinding] = []

    for key, hit in aggregated.items():
        field_path, sensitivity_class = key
        existing = existing_map.get(key)
        if existing is not None and existing.status != FINDING_STATUS_OPEN:
            continue

        drift_id = drift_map.get(field_path)
        if existing is None:
            count = 1
            new_rows.append(
                StreamSensitiveFinding(
                    stream_id=stream_id,
                    field_path=field_path,
                    sensitivity_class=sensitivity_class,
                    detection_method=hit["detection_method"],
                    status=FINDING_STATUS_OPEN,
                    confirm_run_count=count,
                    first_detected_at=now,
                    last_confirmed_at=now,
                    finding_json=_sanitize_finding_json(
                        matched_rule=hit["matched_rule"],
                        matched_segment=hit.get("matched_segment") or leaf_segment(field_path),
                        inferred_type=hit.get("inferred_type"),
                        detection_method=hit["detection_method"],
                        pattern=hit.get("pattern"),
                        confirm_run_count=count,
                    ),
                    related_drift_finding_id=drift_id,
                )
            )
            upserted += 1
            continue

        count = int(existing.confirm_run_count or 0) + 1
        existing.confirm_run_count = count
        existing.last_confirmed_at = now
        existing.detection_method = hit["detection_method"]
        existing.finding_json = _sanitize_finding_json(
            matched_rule=hit["matched_rule"],
            matched_segment=hit.get("matched_segment") or leaf_segment(field_path),
            inferred_type=hit.get("inferred_type"),
            detection_method=hit["detection_method"],
            pattern=hit.get("pattern"),
            confirm_run_count=count,
        )
        if existing.related_drift_finding_id is None and drift_id is not None:
            existing.related_drift_finding_id = drift_id
        upserted += 1

    if new_rows:
        db.add_all(new_rows)

    return upserted


def _upsert_sensitive_hit(
    db: Session,
    *,
    stream_id: int,
    hit: dict[str, Any],
    now: datetime,
) -> StreamSensitiveFinding | None:
    """Single-hit upsert wrapper retained for focused tests."""

    before = _upsert_sensitive_hits_batch(db, stream_id=stream_id, hits=[hit], now=now)
    if before <= 0:
        return None
    field_path = hit["field_path"]
    sensitivity_class = hit["sensitivity_class"]
    return db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.stream_id == stream_id,
            StreamSensitiveFinding.field_path == field_path,
            StreamSensitiveFinding.sensitivity_class == sensitivity_class,
        )
    ).scalar_one_or_none()


def persist_sensitive_hits(
    db: Session,
    *,
    stream_id: int,
    events: list[dict[str, Any]],
    hits: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    """Run detection and upsert findings; return counts for structured logging."""

    if not sensitive_detection_enabled():
        return {"paths_scanned": 0, "hits": 0, "upserted": 0}

    try:
        if hits is None:
            hits = detect_hits_for_batch(events)
    except Exception:
        logger.exception("sensitive_detection_eval_failed stream_id=%s", stream_id)
        return {"paths_scanned": 0, "hits": 0, "upserted": 0}

    now = datetime.now(timezone.utc)
    try:
        upserted = _upsert_sensitive_hits_batch(
            db,
            stream_id=stream_id,
            hits=hits,
            now=now,
        )
    except Exception:
        logger.exception("sensitive_detection_batch_upsert_failed stream_id=%s", stream_id)
        upserted = 0

    return {
        "paths_scanned": len(
            collect_paths_from_events(
                events,
                max_depth=_max_depth(),
                max_paths=_max_paths(),
                max_events=_max_events(),
            )
        ),
        "hits": len(hits),
        "upserted": upserted,
    }


def is_api_visible(finding: StreamSensitiveFinding, *, include_resolved: bool = False) -> bool:
    """Apply confirm gate for open/acknowledged; resolved only in ``all`` listings."""

    if finding.status == FINDING_STATUS_RESOLVED:
        return include_resolved
    return int(finding.confirm_run_count or 0) >= _confirm_runs()
