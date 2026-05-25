"""Detect timestamp, ID/checkpoint, severity, and tenant-like fields."""

from __future__ import annotations

import re
from typing import Any, Literal, TypedDict

CheckpointKind = Literal["TIMESTAMP", "EVENT_ID", "CURSOR", "OFFSET"]

_TS_KEYS = frozenset(
    {
        "creationtime",
        "lastupdatetime",
        "updated_at",
        "timestamp",
        "time",
        "created_at",
        "captured_at",
        "eventtime",
        "occurred_at",
        "modified_at",
        "last_modified",
        "datetime",
        "date",
    }
)
_ID_KEYS = frozenset({"id", "guid", "uuid", "event_id", "malopid", "malop_id", "record_id", "identifier"})
_CURSOR_KEYS = frozenset({"cursor", "next_cursor", "nextcursor", "continuation_token", "page_token", "next_page_token"})
_OFFSET_KEYS = frozenset({"offset", "page", "skip", "start", "startindex"})
_SEVERITY_KEYS = frozenset(
    {
        "severity",
        "level",
        "priority",
        "risk",
        "risk_level",
        "threat_level",
        "alert_level",
        "classification",
    }
)
_TENANT_KEYS = frozenset(
    {
        "tenant",
        "tenant_id",
        "tenantid",
        "organization",
        "organisation",
        "org",
        "org_id",
        "orgid",
        "customer",
        "customer_id",
        "account",
        "account_id",
        "company",
        "company_id",
        "workspace",
        "workspace_id",
    }
)


class FieldCandidate(TypedDict):
    field_path: str
    confidence: float
    reason: str
    sample_value: Any | None


class CheckpointCandidate(TypedDict):
    field_path: str
    checkpoint_type: CheckpointKind
    confidence: float
    sample_value: Any | None
    reason: str


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (bool, int, float, str))


def _iso8601_like(s: str) -> bool:
    return bool(re.search(r"\d{4}-\d{2}-\d{2}|\d{10,13}", s))


def _classify_checkpoint(key: str, value: Any) -> tuple[CheckpointKind, float, str] | None:
    lk = key.lower()
    if lk in _TS_KEYS or any(x in lk for x in ("time", "date", "timestamp", "created", "updated", "modified")):
        if isinstance(value, (int, float)):
            return "TIMESTAMP", 0.82, "numeric field with time-like name"
        if isinstance(value, str) and _iso8601_like(value):
            return "TIMESTAMP", 0.9, "string value resembles timestamp"
        if isinstance(value, str):
            return "TIMESTAMP", 0.55, "time-like field name"
    if lk in _ID_KEYS or lk.endswith("_id") or lk.endswith("id"):
        if isinstance(value, (str, int)):
            return "EVENT_ID", 0.88 if lk in _ID_KEYS else 0.72, "identifier-shaped field"
    if lk in _CURSOR_KEYS or "cursor" in lk or lk.endswith("_token"):
        if isinstance(value, (str, int)):
            return "CURSOR", 0.9 if lk in _CURSOR_KEYS else 0.65, "cursor / pagination token field"
    if lk in _OFFSET_KEYS:
        if isinstance(value, (int, float, str)) and str(value).isdigit():
            return "OFFSET", 0.8, "numeric offset / page field"
        if isinstance(value, (int, float)):
            return "OFFSET", 0.65, "offset-like field name"
    return None


def _scan_object_fields(
    obj: dict[str, Any],
    base: str,
    *,
    classify_fn,
    out: list[FieldCandidate],
    max_depth: int = 2,
    depth: int = 0,
) -> None:
    for k, v in obj.items():
        path = f"$.{k}" if base == "$" else f"{base}.{k}"
        if _is_scalar(v):
            hit = classify_fn(k, v)
            if hit:
                conf, reason = hit
                out.append(
                    FieldCandidate(
                        field_path=path,
                        confidence=round(conf, 4),
                        reason=reason,
                        sample_value=v,
                    )
                )
        elif isinstance(v, dict) and depth < max_depth:
            for k2, v2 in v.items():
                if not _is_scalar(v2):
                    continue
                path2 = f"{path}.{k2}"
                hit = classify_fn(k2, v2)
                if hit:
                    conf, reason = hit
                    out.append(
                        FieldCandidate(
                            field_path=path2,
                            confidence=round(conf * 0.95, 4),
                            reason=f"nested {reason}",
                            sample_value=v2,
                        )
                    )


def _classify_timestamp(key: str, value: Any) -> tuple[float, str] | None:
    lk = key.lower()
    if lk in _TS_KEYS or any(x in lk for x in ("time", "date", "timestamp", "created", "updated", "modified")):
        if isinstance(value, str) and _iso8601_like(value):
            return 0.92, "timestamp-shaped string value"
        if isinstance(value, (int, float)):
            return 0.78, "numeric time-like field"
        if isinstance(value, str):
            return 0.55, "time-like field name"
    return None


def _classify_severity(key: str, value: Any) -> tuple[float, str] | None:
    lk = key.lower()
    if lk in _SEVERITY_KEYS or "severity" in lk or lk.endswith("_level"):
        if isinstance(value, (str, int, float)):
            return 0.85 if lk in _SEVERITY_KEYS else 0.68, "severity or level field"
    return None


def _classify_tenant(key: str, value: Any) -> tuple[float, str] | None:
    lk = key.lower()
    if lk in _TENANT_KEYS or "tenant" in lk or "org" in lk or "customer" in lk:
        if isinstance(value, (str, int)):
            return 0.86 if lk in _TENANT_KEYS else 0.7, "tenant or organization identifier field"
    return None


def detect_timestamp_candidates(sample_event: Any | None, parsed_root: Any | None = None) -> list[FieldCandidate]:
    out: list[FieldCandidate] = []
    for root in (sample_event, parsed_root):
        if isinstance(root, dict):
            _scan_object_fields(root, "$", classify_fn=_classify_timestamp, out=out)
    return _dedupe_fields(out)


def detect_severity_candidates(sample_event: Any | None) -> list[FieldCandidate]:
    out: list[FieldCandidate] = []
    if isinstance(sample_event, dict):
        _scan_object_fields(sample_event, "$", classify_fn=_classify_severity, out=out)
    return _dedupe_fields(out)


def detect_tenant_candidates(sample_event: Any | None) -> list[FieldCandidate]:
    out: list[FieldCandidate] = []
    if isinstance(sample_event, dict):
        _scan_object_fields(sample_event, "$", classify_fn=_classify_tenant, out=out)
    return _dedupe_fields(out)


def _scan_checkpoint_object(obj: dict[str, Any], base: str, out: list[CheckpointCandidate]) -> None:
    for k, v in obj.items():
        path = f"$.{k}" if base == "$" else f"{base}.{k}"
        if _is_scalar(v):
            hit = _classify_checkpoint(k, v)
            if hit:
                ck, conf, reason = hit
                out.append(
                    CheckpointCandidate(
                        field_path=path,
                        checkpoint_type=ck,
                        confidence=round(conf, 4),
                        sample_value=v,
                        reason=reason,
                    )
                )
        elif isinstance(v, dict):
            for k2, v2 in v.items():
                if not _is_scalar(v2):
                    continue
                path2 = f"{path}.{k2}"
                hit = _classify_checkpoint(k2, v2)
                if hit:
                    ck, conf, reason = hit
                    out.append(
                        CheckpointCandidate(
                            field_path=path2,
                            checkpoint_type=ck,
                            confidence=round(conf, 4),
                            sample_value=v2,
                            reason=f"nested {reason}",
                        )
                    )


def detect_checkpoint_candidates(parsed_root: Any, sample_event: Any | None) -> list[CheckpointCandidate]:
    out: list[CheckpointCandidate] = []
    if isinstance(parsed_root, dict):
        _scan_checkpoint_object(parsed_root, "$", out)
    if isinstance(sample_event, dict) and sample_event is not parsed_root:
        _scan_checkpoint_object(sample_event, "$", out)
    out.sort(key=lambda x: -x["confidence"])
    seen: set[tuple[str, str]] = set()
    uniq: list[CheckpointCandidate] = []
    for c in out:
        key = (c["field_path"], c["checkpoint_type"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    return uniq[:24]


def _dedupe_fields(rows: list[FieldCandidate]) -> list[FieldCandidate]:
    rows.sort(key=lambda x: -x["confidence"])
    seen: set[str] = set()
    uniq: list[FieldCandidate] = []
    for c in rows:
        if c["field_path"] in seen:
            continue
        seen.add(c["field_path"])
        uniq.append(c)
    return uniq[:20]
