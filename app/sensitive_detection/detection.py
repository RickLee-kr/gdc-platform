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


def _related_drift_finding_id(db: Session, *, stream_id: int, field_path: str) -> int | None:
    row = db.execute(
        select(StreamSchemaFieldDrift.id).where(
            StreamSchemaFieldDrift.stream_id == stream_id,
            StreamSchemaFieldDrift.field_path == field_path,
            StreamSchemaFieldDrift.category == DRIFT_CATEGORY_FIELD_ADDED,
            StreamSchemaFieldDrift.status == DRIFT_STATUS_OPEN,
        )
    ).scalar_one_or_none()
    return int(row) if row is not None else None


def _upsert_sensitive_hit(
    db: Session,
    *,
    stream_id: int,
    hit: dict[str, Any],
    now: datetime,
) -> StreamSensitiveFinding | None:
    field_path = hit["field_path"]
    sensitivity_class = hit["sensitivity_class"]
    existing = db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.stream_id == stream_id,
            StreamSensitiveFinding.field_path == field_path,
            StreamSensitiveFinding.sensitivity_class == sensitivity_class,
        )
    ).scalar_one_or_none()

    if existing is not None and existing.status != FINDING_STATUS_OPEN:
        return None

    confirm_after = _confirm_runs()
    if existing is None:
        count = 1
        row = StreamSensitiveFinding(
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
            related_drift_finding_id=_related_drift_finding_id(db, stream_id=stream_id, field_path=field_path),
        )
        db.add(row)
        return row if count >= confirm_after else row

    existing.confirm_run_count = int(existing.confirm_run_count or 0) + 1
    existing.last_confirmed_at = now
    existing.detection_method = hit["detection_method"]
    count = int(existing.confirm_run_count)
    existing.finding_json = _sanitize_finding_json(
        matched_rule=hit["matched_rule"],
        matched_segment=hit.get("matched_segment") or leaf_segment(field_path),
        inferred_type=hit.get("inferred_type"),
        detection_method=hit["detection_method"],
        pattern=hit.get("pattern"),
        confirm_run_count=count,
    )
    if existing.related_drift_finding_id is None:
        existing.related_drift_finding_id = _related_drift_finding_id(
            db, stream_id=stream_id, field_path=field_path
        )
    return existing


def persist_sensitive_hits(
    db: Session,
    *,
    stream_id: int,
    events: list[dict[str, Any]],
) -> dict[str, int]:
    """Run detection and upsert findings; return counts for structured logging."""

    if not sensitive_detection_enabled():
        return {"paths_scanned": 0, "hits": 0, "upserted": 0}

    try:
        hits = detect_hits_for_batch(events)
    except Exception:
        logger.exception("sensitive_detection_eval_failed stream_id=%s", stream_id)
        return {"paths_scanned": 0, "hits": 0, "upserted": 0}

    now = datetime.now(timezone.utc)
    upserted = 0
    for hit in hits:
        try:
            row = _upsert_sensitive_hit(db, stream_id=stream_id, hit=hit, now=now)
            if row is not None:
                upserted += 1
        except Exception:
            logger.exception(
                "sensitive_detection_upsert_failed stream_id=%s path=%s",
                stream_id,
                hit.get("field_path"),
            )

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
