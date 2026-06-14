"""Schema Drift Policy orchestrator — compose existing engines only."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.config import settings
from app.protection.models import POLICY_ACTION_QUARANTINE
from app.protection.policy_engine import PolicyBatchResult, PolicyEvaluationItem
from app.schema_drift_policy.path_resolve import (
    build_protection_path_alias_map,
    collect_enriched_field_paths,
    path_exists_in_batch,
    resolve_protection_field_path,
)
from app.schema_drift_policy.schemas import SchemaDriftPolicyConfig, load_schema_drift_policy
from app.schema_observation.drift_detection import list_open_field_drifts
from app.schema_observation.models import DRIFT_CATEGORY_FIELD_ADDED
from app.sensitive_detection.context import SensitiveDetectionContext

logger = logging.getLogger(__name__)

SCHEMA_DRIFT_VIRTUAL_POLICY_ID = 0

_ACTION_STRENGTH = {
    "pass_through": 0,
    "require_review": 0,
    "auto_protect": 1,
    "quarantine": 2,
}

LogFn = Callable[[dict[str, Any]], None]


@dataclass
class UnknownFieldMatch:
    extracted_path: str
    enriched_path: str
    drift_finding_id: int
    is_sensitive: bool
    sensitivity_class: str | None = None
    applied_policy: str = ""


@dataclass
class SchemaDriftPolicyResult:
    enabled: bool = False
    config: SchemaDriftPolicyConfig | None = None
    batch_action: str = "noop"
    unknown_fields: list[UnknownFieldMatch] = field(default_factory=list)
    unresolved_paths: list[str] = field(default_factory=list)
    should_quarantine: bool = False
    quarantine_policy_type: str | None = None
    review_fields: list[UnknownFieldMatch] = field(default_factory=list)


def schema_drift_policy_enabled() -> bool:
    return bool(settings.GDC_SCHEMA_DRIFT_POLICY_ENABLED)


def _effective_policy_value(raw_policy: str) -> str:
    """Phase 1: auto_protect behaves like require_review until Protection Engine hook."""

    if raw_policy == "auto_protect":
        # Phase 2: Protection Engine ephemeral mask for unknown sensitive fields.
        return "require_review"
    return raw_policy


def _sensitive_paths_from_context(context: SensitiveDetectionContext | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if context is None:
        return out
    for item in context.findings:
        if not isinstance(item, dict):
            continue
        path = str(item.get("field_path") or "").strip()
        if not path:
            continue
        sensitivity = str(item.get("sensitivity_class") or "").strip() or None
        out[path] = sensitivity or out.get(path) or ""
    return out


def _resolve_batch_action(
    *,
    normal_policy: str,
    sensitive_policy: str,
    has_normal: bool,
    has_sensitive: bool,
) -> str:
    actions: list[tuple[int, str, bool]] = []
    if has_normal:
        effective = _effective_policy_value(normal_policy)
        actions.append((_ACTION_STRENGTH.get(effective, 0), effective, False))
    if has_sensitive:
        effective = _effective_policy_value(sensitive_policy)
        actions.append((_ACTION_STRENGTH.get(effective, 0), effective, True))
    if not actions:
        return "noop"

    max_strength = max(item[0] for item in actions)
    strongest = [item for item in actions if item[0] == max_strength]
    if len(strongest) == 1:
        return strongest[0][1]
    sensitive_first = [item for item in strongest if item[2]]
    if sensitive_first:
        return sensitive_first[0][1]
    return strongest[0][1]


def apply_schema_drift_policy_to_batch(
    db: Session | None,
    *,
    stream_id: int,
    stream_config_json: dict[str, Any] | None,
    field_mappings: dict[str, Any] | None,
    enrichment_json: dict[str, Any] | None,
    enriched_events: list[dict[str, Any]],
    detection_context: SensitiveDetectionContext | None,
    log_fn: LogFn | None = None,
) -> SchemaDriftPolicyResult:
    """Evaluate schema drift policy for one enriched batch (post-sensitive detection)."""

    config = load_schema_drift_policy(stream_config_json)
    result = SchemaDriftPolicyResult(enabled=schema_drift_policy_enabled(), config=config)
    if not result.enabled or db is None or not enriched_events:
        return result

    open_drifts = [
        row
        for row in list_open_field_drifts(db, stream_id)
        if str(row.category) == DRIFT_CATEGORY_FIELD_ADDED
    ]
    if not open_drifts:
        return result

    runtime_paths = collect_enriched_field_paths(enriched_events)
    alias_map = build_protection_path_alias_map(
        field_mappings=field_mappings,
        enrichment_json=enrichment_json,
    )
    sensitive_by_path = _sensitive_paths_from_context(detection_context)

    unknown_fields: list[UnknownFieldMatch] = []
    unresolved_paths: list[str] = []

    for drift in open_drifts:
        extracted_path = str(drift.field_path or "").strip()
        if not extracted_path:
            continue
        resolved = resolve_protection_field_path(extracted_path, runtime_paths, alias_map)
        if not resolved.ok:
            unresolved_paths.append(extracted_path)
            if log_fn is not None:
                log_fn(
                    {
                        "stage": "schema_drift_policy_path_resolution_failed",
                        "stream_id": stream_id,
                        "extracted_path": extracted_path,
                        "field_path": extracted_path,
                        "policy_type": "path_resolution",
                        "sensitive": False,
                        "message": resolved.error,
                    }
                )
            continue

        enriched_path = resolved.resolved_path
        if not path_exists_in_batch(enriched_events, enriched_path):
            continue

        sensitivity_class = sensitive_by_path.get(enriched_path)
        is_sensitive = enriched_path in sensitive_by_path
        unknown_fields.append(
            UnknownFieldMatch(
                extracted_path=extracted_path,
                enriched_path=enriched_path,
                drift_finding_id=int(drift.id),
                is_sensitive=is_sensitive,
                sensitivity_class=sensitivity_class,
            )
        )

    if not unknown_fields:
        result.unresolved_paths = unresolved_paths
        return result

    has_normal = any(not item.is_sensitive for item in unknown_fields)
    has_sensitive = any(item.is_sensitive for item in unknown_fields)
    batch_action = _resolve_batch_action(
        normal_policy=config.unknown_normal_field_policy,
        sensitive_policy=config.unknown_sensitive_field_policy,
        has_normal=has_normal,
        has_sensitive=has_sensitive,
    )
    result.batch_action = batch_action
    result.unknown_fields = unknown_fields
    result.unresolved_paths = unresolved_paths

    for item in unknown_fields:
        raw_policy = (
            config.unknown_sensitive_field_policy
            if item.is_sensitive
            else config.unknown_normal_field_policy
        )
        item.applied_policy = _effective_policy_value(raw_policy)

    if batch_action == "pass_through":
        if log_fn is not None:
            log_fn(
                {
                    "stage": "schema_drift_policy",
                    "stream_id": stream_id,
                    "action": "pass_through",
                    "unknown_normal_paths": [
                        item.enriched_path for item in unknown_fields if not item.is_sensitive
                    ],
                    "unknown_sensitive_paths": [
                        item.enriched_path for item in unknown_fields if item.is_sensitive
                    ],
                }
            )
        return result

    if batch_action == "require_review":
        review_items = [
            item
            for item in unknown_fields
            if item.applied_policy == "require_review"
            or (
                item.is_sensitive
                and config.unknown_sensitive_field_policy == "auto_protect"
            )
        ]
        result.review_fields = review_items
        for item in review_items:
            policy_type = "unknown_sensitive" if item.is_sensitive else "unknown_normal"
            is_auto_protect_phase1 = (
                item.is_sensitive
                and config.unknown_sensitive_field_policy == "auto_protect"
            )
            if log_fn is None:
                continue
            if is_auto_protect_phase1:
                # Phase 2: Protection Engine ephemeral mask
                log_fn(
                    {
                        "stage": "schema_drift_policy_auto_protect_phase1",
                        "stream_id": stream_id,
                        "field_path": item.enriched_path,
                        "extracted_path": item.extracted_path,
                        "policy_type": policy_type,
                        "configured_policy": "auto_protect",
                        "sensitive": True,
                        "sensitivity_class": item.sensitivity_class,
                        "drift_finding_id": item.drift_finding_id,
                        "message": (
                            "Auto Protect is not active in Phase 1; "
                            "no ephemeral masking applied."
                        ),
                    }
                )
                continue
            log_fn(
                {
                    "stage": "schema_drift_policy_review_required",
                    "stream_id": stream_id,
                    "field_path": item.enriched_path,
                    "extracted_path": item.extracted_path,
                    "policy_type": policy_type,
                    "configured_policy": item.applied_policy,
                    "sensitive": item.is_sensitive,
                    "sensitivity_class": item.sensitivity_class,
                    "drift_finding_id": item.drift_finding_id,
                }
            )
        return result

    if batch_action == "quarantine":
        quarantine_items = [
            item
            for item in unknown_fields
            if item.applied_policy == "quarantine"
        ]
        if not quarantine_items:
            quarantine_items = list(unknown_fields)
        dominant = next((item for item in quarantine_items if item.is_sensitive), quarantine_items[0])
        result.should_quarantine = True
        result.quarantine_policy_type = "unknown_sensitive" if dominant.is_sensitive else "unknown_normal"
        if log_fn is not None:
            log_fn(
                {
                    "stage": "schema_drift_policy",
                    "stream_id": stream_id,
                    "action": "quarantine",
                    "policy_type": result.quarantine_policy_type,
                    "field_paths": [item.enriched_path for item in quarantine_items],
                    "drift_finding_ids": [item.drift_finding_id for item in quarantine_items],
                }
            )
        return result

    return result


def merge_schema_drift_quarantine(
    policy_result: PolicyBatchResult,
    *,
    policy_type: str,
    field_paths: list[str],
) -> PolicyBatchResult:
    """Inject virtual quarantine evaluation for existing policy quarantine path."""

    if not field_paths:
        return policy_result
    virtual = PolicyEvaluationItem(
        policy_id=SCHEMA_DRIFT_VIRTUAL_POLICY_ID,
        matched=True,
        policy_name=f"schema_drift:{policy_type}",
        action_type=POLICY_ACTION_QUARANTINE,
    )
    policy_result.evaluations.append(virtual)
    policy_result.matched_policies.append({"name": virtual.policy_name})
    policy_result.matched_policy_count = len(
        [item for item in policy_result.evaluations if item.matched]
    )
    return policy_result
