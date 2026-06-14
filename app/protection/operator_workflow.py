"""M6 protection — operator workflow (rules + sensitive finding resolve)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.protection.engine import protection_enabled
from app.protection.models import (
    PROTECTION_MODE_FULL_MASK,
    PROTECTION_MODE_PARTIAL_MASK,
    PROTECTION_MODES,
    StreamProtectionRule,
)
from app.sensitive_detection.detection import _confirm_runs
from app.sensitive_detection.models import (
    FINDING_STATUS_ACKNOWLEDGED,
    FINDING_STATUS_RESOLVED,
    RESOLUTION_FALSE_POSITIVE,
    RESOLUTION_PROTECTION_APPLIED,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
    SENSITIVITY_CLASS_SECURITY_METADATA,
    StreamSensitiveFinding,
)

_DEFAULT_MODE_BY_CLASS = {
    SENSITIVITY_CLASS_SECRET: PROTECTION_MODE_FULL_MASK,
    SENSITIVITY_CLASS_PII: PROTECTION_MODE_PARTIAL_MASK,
    SENSITIVITY_CLASS_SECURITY_METADATA: PROTECTION_MODE_FULL_MASK,
}


class ProtectionRuleNotFoundError(Exception):
    def __init__(self, rule_id: int) -> None:
        self.rule_id = rule_id
        super().__init__(f"protection rule not found: {rule_id}")


class ProtectionRuleConflictError(Exception):
    pass


class ProtectionRuleValidationError(Exception):
    pass


class SensitiveFindingNotFoundError(Exception):
    def __init__(self, finding_id: int) -> None:
        self.finding_id = finding_id
        super().__init__(f"sensitive finding not found: {finding_id}")


class SensitiveFindingStateError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


DirectUpsertOutcome = str  # "created" | "updated" | "skipped"


def wizard_protection_skip_reason(field_path: str) -> str:
    return f"{field_path} already has a runtime protection rule. Wizard rule was skipped."


def default_mode_for_class(sensitivity_class: str) -> str:
    return _DEFAULT_MODE_BY_CLASS.get(sensitivity_class, PROTECTION_MODE_FULL_MASK)


def _rule_entry(rule: StreamProtectionRule, *, finding: StreamSensitiveFinding | None = None) -> dict[str, Any]:
    matched_rule: str | None = None
    detection_method: str | None = None
    if finding is not None:
        detection_method = finding.detection_method
        fj = finding.finding_json if isinstance(finding.finding_json, dict) else {}
        raw = fj.get("matched_rule")
        matched_rule = str(raw) if raw is not None else None
    return {
        "id": rule.id,
        "stream_id": rule.stream_id,
        "field_path": rule.field_path,
        "sensitivity_class": rule.sensitivity_class,
        "protection_mode": rule.protection_mode,
        "enabled": bool(rule.enabled),
        "source_finding_id": rule.source_finding_id,
        "created_by": rule.created_by,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
        "detection_method": detection_method,
        "matched_rule": matched_rule,
    }


def list_protection_rules(
    db: Session,
    stream_id: int,
    *,
    enabled_only: bool = False,
) -> list[dict[str, Any]]:
    stmt = select(StreamProtectionRule).where(StreamProtectionRule.stream_id == stream_id)
    if enabled_only:
        stmt = stmt.where(StreamProtectionRule.enabled.is_(True))
    stmt = stmt.order_by(StreamProtectionRule.field_path)
    rules = list(db.execute(stmt).scalars())
    finding_ids = [r.source_finding_id for r in rules if r.source_finding_id is not None]
    findings_by_id: dict[int, StreamSensitiveFinding] = {}
    if finding_ids:
        rows = db.execute(
            select(StreamSensitiveFinding).where(StreamSensitiveFinding.id.in_(finding_ids))
        ).scalars()
        findings_by_id = {int(f.id): f for f in rows}
    return [
        _rule_entry(r, finding=findings_by_id.get(int(r.source_finding_id)) if r.source_finding_id else None)
        for r in rules
    ]


def build_protection_summary(db: Session, stream_id: int) -> dict[str, Any]:
    from app.protection.metrics import load_protection_runtime_metrics

    rows = list(
        db.execute(select(StreamProtectionRule).where(StreamProtectionRule.stream_id == stream_id)).scalars()
    )
    enabled_count = 0
    disabled_count = 0
    by_mode = {"full_mask": 0, "partial_mask": 0, "hash": 0, "tokenization": 0}
    by_class = {
        SENSITIVITY_CLASS_SECRET: 0,
        SENSITIVITY_CLASS_PII: 0,
        SENSITIVITY_CLASS_SECURITY_METADATA: 0,
    }
    for rule in rows:
        if rule.enabled:
            enabled_count += 1
            if rule.protection_mode in by_mode:
                by_mode[rule.protection_mode] += 1
            if rule.sensitivity_class in by_class:
                by_class[rule.sensitivity_class] += 1
        else:
            disabled_count += 1
    total_rules = len(rows)
    from app.protection.identity_vault import count_vault_entries_for_stream

    vault_entry_count = count_vault_entries_for_stream(db, stream_id)
    runtime_metrics = load_protection_runtime_metrics(db, stream_id, total_rules=total_rules)
    return {
        "stream_id": stream_id,
        "protection_enabled": protection_enabled(),
        "enabled_rule_count": enabled_count,
        "disabled_rule_count": disabled_count,
        "by_mode": by_mode,
        "by_class": by_class,
        "full_mask_count": by_mode["full_mask"],
        "partial_mask_count": by_mode["partial_mask"],
        "hash_count": by_mode["hash"],
        "tokenization_count": by_mode["tokenization"],
        "vault_entry_count": vault_entry_count,
        "total_rules": total_rules,
        "total_protected_events": int(runtime_metrics["protected_events"]),
        "total_protected_fields": int(runtime_metrics["protected_fields"]),
        "last_protected_at": runtime_metrics.get("last_protected_at"),
        "protection_rules": int(runtime_metrics["protection_rules"]),
        "protected_events": int(runtime_metrics["protected_events"]),
        "protected_fields": int(runtime_metrics["protected_fields"]),
    }


def _validate_protection_rule_fields(
    *,
    field_path: str,
    sensitivity_class: str,
    protection_mode: str,
) -> str:
    if protection_mode not in PROTECTION_MODES:
        raise ProtectionRuleValidationError(f"invalid protection_mode: {protection_mode!r}")
    path = field_path.strip()
    if not path.startswith("$"):
        raise ProtectionRuleValidationError("field_path must start with $")
    if sensitivity_class not in (
        SENSITIVITY_CLASS_SECRET,
        SENSITIVITY_CLASS_PII,
        SENSITIVITY_CLASS_SECURITY_METADATA,
    ):
        raise ProtectionRuleValidationError(f"invalid sensitivity_class: {sensitivity_class!r}")
    return path


def upsert_protection_rule_direct(
    db: Session,
    *,
    stream_id: int,
    field_path: str,
    sensitivity_class: str,
    protection_mode: str,
    enabled: bool,
    actor_username: str,
) -> tuple[StreamProtectionRule | None, DirectUpsertOutcome]:
    """Create or update a wizard/config rule without a sensitive finding (source_finding_id=null).

    When an existing rule was created from a runtime finding (source_finding_id set), the wizard
    rule is skipped and the existing row is left unchanged.
    """

    path = _validate_protection_rule_fields(
        field_path=field_path,
        sensitivity_class=sensitivity_class,
        protection_mode=protection_mode,
    )
    existing = db.execute(
        select(StreamProtectionRule).where(
            StreamProtectionRule.stream_id == stream_id,
            StreamProtectionRule.field_path == path,
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is not None:
        if existing.source_finding_id is not None:
            return existing, "skipped"
        existing.sensitivity_class = sensitivity_class
        existing.protection_mode = protection_mode
        existing.enabled = enabled
        existing.updated_at = now
        return existing, "updated"

    rule = StreamProtectionRule(
        stream_id=stream_id,
        field_path=path,
        sensitivity_class=sensitivity_class,
        protection_mode=protection_mode,
        enabled=enabled,
        source_finding_id=None,
        created_by=actor_username,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    try:
        db.flush()
    except IntegrityError as exc:
        raise ProtectionRuleConflictError(f"rule already exists for path {path!r}") from exc
    return rule, "created"


def upsert_protection_rules_direct_bulk(
    db: Session,
    *,
    stream_id: int,
    rules: list[dict[str, Any]],
    actor_username: str,
) -> tuple[list[StreamProtectionRule], int, int, list[dict[str, Any]]]:
    created = 0
    updated = 0
    skipped: list[dict[str, Any]] = []
    out: list[StreamProtectionRule] = []
    for item in rules:
        rule, outcome = upsert_protection_rule_direct(
            db,
            stream_id=stream_id,
            field_path=str(item["field_path"]),
            sensitivity_class=str(item["sensitivity_class"]),
            protection_mode=str(item["protection_mode"]),
            enabled=bool(item.get("enabled", True)),
            actor_username=actor_username,
        )
        if outcome == "created":
            created += 1
            if rule is not None:
                out.append(rule)
        elif outcome == "updated":
            updated += 1
            if rule is not None:
                out.append(rule)
        elif outcome == "skipped":
            skipped.append(
                {
                    "field_path": rule.field_path if rule is not None else str(item["field_path"]).strip(),
                    "reason": wizard_protection_skip_reason(
                        rule.field_path if rule is not None else str(item["field_path"]).strip()
                    ),
                    "existing_rule_id": int(rule.id) if rule is not None else None,
                }
            )
    return out, created, updated, skipped


def create_protection_rule(
    db: Session,
    *,
    stream_id: int,
    field_path: str,
    sensitivity_class: str,
    protection_mode: str,
    source_finding_id: int,
    enabled: bool,
    actor_username: str,
    auto_resolve_finding: bool = True,
) -> StreamProtectionRule:
    if protection_mode not in PROTECTION_MODES:
        raise ProtectionRuleValidationError(f"invalid protection_mode: {protection_mode!r}")
    path = field_path.strip()
    if not path.startswith("$"):
        raise ProtectionRuleValidationError("field_path must start with $")

    finding = db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.id == source_finding_id,
            StreamSensitiveFinding.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if finding is None:
        raise SensitiveFindingNotFoundError(source_finding_id)
    if finding.status != FINDING_STATUS_ACKNOWLEDGED:
        raise SensitiveFindingStateError(
            f"finding {source_finding_id} must be acknowledged (status={finding.status!r})"
        )
    if int(finding.confirm_run_count or 0) < _confirm_runs():
        raise SensitiveFindingStateError(
            f"finding {source_finding_id} not confirmed ({finding.confirm_run_count} < {_confirm_runs()})"
        )
    if finding.field_path != path:
        raise ProtectionRuleValidationError("field_path must match the source finding field_path")

    now = datetime.now(timezone.utc)
    rule = StreamProtectionRule(
        stream_id=stream_id,
        field_path=path,
        sensitivity_class=sensitivity_class,
        protection_mode=protection_mode,
        enabled=enabled,
        source_finding_id=source_finding_id,
        created_by=actor_username,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    try:
        db.flush()
    except IntegrityError as exc:
        raise ProtectionRuleConflictError(f"rule already exists for path {path!r}") from exc

    if auto_resolve_finding:
        _resolve_finding_protection_applied(
            finding,
            actor_username=actor_username,
            now=now,
        )
    return rule


def patch_protection_rule(
    db: Session,
    *,
    stream_id: int,
    rule_id: int,
    protection_mode: str | None = None,
    enabled: bool | None = None,
    sensitivity_class: str | None = None,
) -> StreamProtectionRule:
    rule = db.execute(
        select(StreamProtectionRule).where(
            StreamProtectionRule.id == rule_id,
            StreamProtectionRule.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if rule is None:
        raise ProtectionRuleNotFoundError(rule_id)
    if protection_mode is not None:
        if protection_mode not in PROTECTION_MODES:
            raise ProtectionRuleValidationError(f"invalid protection_mode: {protection_mode!r}")
        rule.protection_mode = protection_mode
    if enabled is not None:
        rule.enabled = enabled
    if sensitivity_class is not None:
        rule.sensitivity_class = sensitivity_class
    rule.updated_at = datetime.now(timezone.utc)
    return rule


def resolve_sensitive_finding(
    db: Session,
    *,
    stream_id: int,
    finding_id: int,
    resolution: str,
    actor_username: str,
    note: str | None = None,
) -> StreamSensitiveFinding:
    finding = db.execute(
        select(StreamSensitiveFinding).where(
            StreamSensitiveFinding.id == finding_id,
            StreamSensitiveFinding.stream_id == stream_id,
        )
    ).scalar_one_or_none()
    if finding is None:
        raise SensitiveFindingNotFoundError(finding_id)
    if finding.status != FINDING_STATUS_ACKNOWLEDGED:
        raise SensitiveFindingStateError(
            f"finding {finding_id} cannot be resolved from status {finding.status!r}"
        )

    now = datetime.now(timezone.utc)
    if resolution == RESOLUTION_FALSE_POSITIVE:
        finding.status = FINDING_STATUS_RESOLVED
        finding.resolved_at = now
        finding.resolved_by = actor_username
        finding.resolution = RESOLUTION_FALSE_POSITIVE
        if note and note.strip():
            finding.operator_note = note.strip()
        linked = db.execute(
            select(StreamProtectionRule).where(
                StreamProtectionRule.stream_id == stream_id,
                StreamProtectionRule.source_finding_id == finding_id,
            )
        ).scalar_one_or_none()
        if linked is not None:
            linked.enabled = False
            linked.updated_at = now
        return finding

    if resolution == RESOLUTION_PROTECTION_APPLIED:
        rule = db.execute(
            select(StreamProtectionRule).where(
                StreamProtectionRule.stream_id == stream_id,
                StreamProtectionRule.field_path == finding.field_path,
                StreamProtectionRule.enabled.is_(True),
            )
        ).scalar_one_or_none()
        if rule is None:
            raise SensitiveFindingStateError(
                f"no enabled protection rule for field_path {finding.field_path!r}"
            )
        _resolve_finding_protection_applied(finding, actor_username=actor_username, now=now, note=note)
        return finding

    raise ProtectionRuleValidationError(f"unsupported resolution: {resolution!r}")


def _resolve_finding_protection_applied(
    finding: StreamSensitiveFinding,
    *,
    actor_username: str,
    now: datetime,
    note: str | None = None,
) -> None:
    finding.status = FINDING_STATUS_RESOLVED
    finding.resolved_at = now
    finding.resolved_by = actor_username
    finding.resolution = RESOLUTION_PROTECTION_APPLIED
    if note and note.strip():
        finding.operator_note = note.strip()


def load_enabled_rules(db: Session, stream_id: int) -> list[StreamProtectionRule]:
    if not hasattr(db, "execute"):
        return []
    return list(
        db.execute(
            select(StreamProtectionRule)
            .where(
                StreamProtectionRule.stream_id == stream_id,
                StreamProtectionRule.enabled.is_(True),
            )
            .order_by(StreamProtectionRule.id)
        ).scalars()
    )
