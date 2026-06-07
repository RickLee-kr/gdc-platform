"""Classification delivery_logs metrics (bounded reads; no full-table scans)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.classification.engine import ClassificationBatchResult
from app.classification.levels import normalize_level
from app.classification.models import (
    CLASSIFICATION_CONFIDENTIAL,
    CLASSIFICATION_INTERNAL,
    CLASSIFICATION_PUBLIC,
    CLASSIFICATION_RESTRICTED,
    StreamClassificationRule,
)
from app.logs.models import DeliveryLog
from app.platform_summary.stage_metrics import (
    load_latest_stage_metrics,
    load_latest_stage_row,
    load_recent_stage_rows,
)

CLASSIFICATION_COMPLETE_STAGE = "classification_complete"
_DEFAULT_RECENT_LOG_LIMIT = 500

_DISTRIBUTION_LEVELS = (
    CLASSIFICATION_PUBLIC,
    CLASSIFICATION_INTERNAL,
    CLASSIFICATION_CONFIDENTIAL,
    CLASSIFICATION_RESTRICTED,
)

_TOTAL_COUNT_KEYS: dict[str, str] = {
    CLASSIFICATION_PUBLIC: "total_public_count",
    CLASSIFICATION_INTERNAL: "total_internal_count",
    CLASSIFICATION_CONFIDENTIAL: "total_confidential_count",
    CLASSIFICATION_RESTRICTED: "total_restricted_count",
}

_SUMMARY_COUNT_KEYS: dict[str, str] = {
    CLASSIFICATION_PUBLIC: "public_count",
    CLASSIFICATION_INTERNAL: "internal_count",
    CLASSIFICATION_CONFIDENTIAL: "confidential_count",
    CLASSIFICATION_RESTRICTED: "restricted_count",
}


def _empty_distribution() -> dict[str, int]:
    return {key: 0 for key in _SUMMARY_COUNT_KEYS.values()}


def _distribution_from_sample(sample: dict[str, Any]) -> dict[str, int] | None:
    if not any(key in sample for key in _TOTAL_COUNT_KEYS.values()):
        return None
    return {
        summary_key: max(0, int(sample.get(total_key) or 0))
        for level, total_key in _TOTAL_COUNT_KEYS.items()
        for summary_key in [_SUMMARY_COUNT_KEYS[level]]
    }


def _distribution_from_rows(rows: list[DeliveryLog]) -> dict[str, int]:
    counts = _empty_distribution()
    for row in rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        level = normalize_level(str(sample.get("classification_level") or ""))
        if level is None:
            continue
        summary_key = _SUMMARY_COUNT_KEYS.get(level)
        if summary_key is not None:
            counts[summary_key] += 1
    return counts


def load_cumulative_classification_distribution(db: Session, stream_id: int) -> dict[str, int]:
    """Read running distribution totals from the latest classification_complete row."""

    row = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=CLASSIFICATION_COMPLETE_STAGE,
    )
    if row is None:
        return _empty_distribution()
    sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
    distribution = _distribution_from_sample(sample)
    return distribution if distribution is not None else _empty_distribution()


def build_classification_complete_payload(
    *,
    stream_id: int,
    result: ClassificationBatchResult,
    cumulative_distribution: dict[str, int] | None = None,
) -> dict[str, Any]:
    processing_time_ms = max(0, int(result.duration_ms or 0))
    level = normalize_level(str(result.classification_level)) or CLASSIFICATION_INTERNAL
    prev = cumulative_distribution if cumulative_distribution is not None else _empty_distribution()
    distribution = dict(prev)
    summary_key = _SUMMARY_COUNT_KEYS.get(level)
    if summary_key is not None:
        distribution[summary_key] = int(prev.get(summary_key) or 0) + 1

    payload: dict[str, Any] = {
        "stage": CLASSIFICATION_COMPLETE_STAGE,
        "stream_id": stream_id,
        "message": "classification complete",
        "classification_level": level,
        "matched_rule_count": max(0, int(result.matched_rule_count or 0)),
        "processing_time_ms": processing_time_ms,
        "latency_ms": processing_time_ms,
    }
    for lvl, total_key in _TOTAL_COUNT_KEYS.items():
        payload[total_key] = max(0, int(distribution.get(_SUMMARY_COUNT_KEYS[lvl]) or 0))
    return payload


def load_classification_runtime_metrics(
    db: Session,
    stream_id: int,
    *,
    recent_log_limit: int = _DEFAULT_RECENT_LOG_LIMIT,
) -> dict[str, Any]:
    """Bounded metrics for classification summary / runtime UI."""

    latest = load_latest_stage_row(
        db,
        stream_id=int(stream_id),
        stage=CLASSIFICATION_COMPLETE_STAGE,
    )
    last_level: str | None = None
    last_at: datetime | None = None
    if latest is not None:
        sample = latest.payload_sample if isinstance(latest.payload_sample, dict) else {}
        raw_level = sample.get("classification_level")
        if raw_level is not None:
            last_level = str(raw_level)
        last_at = latest.created_at
        distribution = _distribution_from_sample(sample)
        if distribution is not None:
            return {
                "last_classification_level": last_level,
                "last_classified_at": last_at,
                **_empty_distribution(),
                **distribution,
            }

    rows = load_recent_stage_rows(
        db,
        stream_id=int(stream_id),
        stage=CLASSIFICATION_COMPLETE_STAGE,
        limit=recent_log_limit,
    )
    distribution = _distribution_from_rows(rows)
    if rows and last_at is None:
        last_at = rows[0].created_at
        sample = rows[0].payload_sample if isinstance(rows[0].payload_sample, dict) else {}
        raw_level = sample.get("classification_level")
        if raw_level is not None:
            last_level = str(raw_level)
    return {
        "last_classification_level": last_level,
        "last_classified_at": last_at,
        **distribution,
    }


def build_stream_classification_summary(db: Session, stream_id: int) -> dict[str, Any]:
    rows = list(
        db.execute(select(StreamClassificationRule).where(StreamClassificationRule.stream_id == stream_id)).scalars()
    )
    runtime = load_classification_runtime_metrics(db, stream_id)
    return {
        "stream_id": stream_id,
        "total_rules": len(rows),
        "public_count": int(runtime.get("public_count") or 0),
        "internal_count": int(runtime.get("internal_count") or 0),
        "confidential_count": int(runtime.get("confidential_count") or 0),
        "restricted_count": int(runtime.get("restricted_count") or 0),
        "last_classified_at": runtime.get("last_classified_at"),
        "last_classification_level": runtime.get("last_classification_level"),
    }


def build_platform_classification_summary(db: Session) -> dict[str, Any]:
    total_rules = int(
        db.execute(select(func.count()).select_from(StreamClassificationRule)).scalar_one() or 0
    )
    latest_rows = load_latest_stage_metrics(db, stage=CLASSIFICATION_COMPLETE_STAGE)
    distribution = _empty_distribution()
    last_at: datetime | None = None
    for row in latest_rows:
        sample = row.payload_sample if isinstance(row.payload_sample, dict) else {}
        row_distribution = _distribution_from_sample(sample)
        if row_distribution is not None:
            for key, value in row_distribution.items():
                distribution[key] += value
        else:
            level = normalize_level(str(sample.get("classification_level") or ""))
            if level is not None:
                summary_key = _SUMMARY_COUNT_KEYS.get(level)
                if summary_key is not None:
                    distribution[summary_key] += 1
        if last_at is None or (row.created_at is not None and row.created_at > last_at):
            last_at = row.created_at
    return {
        "total_rules": total_rules,
        **distribution,
        "last_classified_at": last_at,
    }
