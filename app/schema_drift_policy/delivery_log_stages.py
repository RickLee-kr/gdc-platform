"""Schema Drift Policy delivery_logs.stage tokens (keep in sync with frontend delivery-log-stages.ts)."""

from __future__ import annotations

from typing import Any

SCHEMA_DRIFT_POLICY_STAGE = "schema_drift_policy"
SCHEMA_DRIFT_POLICY_REVIEW_REQUIRED_STAGE = "schema_drift_policy_review_required"
SCHEMA_DRIFT_POLICY_PATH_RESOLUTION_FAILED_STAGE = "schema_drift_policy_path_resolution_failed"
SCHEMA_DRIFT_POLICY_AUTO_PROTECT_APPLIED_STAGE = "schema_drift_policy_auto_protect_applied"

SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES = frozenset(
    {
        SCHEMA_DRIFT_POLICY_STAGE,
        SCHEMA_DRIFT_POLICY_REVIEW_REQUIRED_STAGE,
        SCHEMA_DRIFT_POLICY_PATH_RESOLUTION_FAILED_STAGE,
        SCHEMA_DRIFT_POLICY_AUTO_PROTECT_APPLIED_STAGE,
    }
)


def schema_drift_policy_delivery_log_message(payload: dict[str, Any]) -> str | None:
    """Human-readable delivery_logs.message for schema drift policy stages."""

    stage = str(payload.get("stage") or "").strip()
    if stage == SCHEMA_DRIFT_POLICY_AUTO_PROTECT_APPLIED_STAGE:
        field_path = str(payload.get("field_path") or "").strip() or "unknown path"
        mode = str(payload.get("protection_mode") or "").strip() or "unknown mode"
        return f"Auto protect applied: {field_path} ({mode})"
    if stage == SCHEMA_DRIFT_POLICY_REVIEW_REQUIRED_STAGE:
        field_path = str(payload.get("field_path") or "").strip() or "unknown path"
        policy_type = str(payload.get("policy_type") or "").strip() or "unknown"
        return f"Schema drift policy review required: {field_path} ({policy_type})"
    if stage == SCHEMA_DRIFT_POLICY_PATH_RESOLUTION_FAILED_STAGE:
        extracted = str(payload.get("extracted_path") or payload.get("field_path") or "").strip()
        return f"Schema drift path resolution failed: {extracted or 'unknown path'}"
    if stage == SCHEMA_DRIFT_POLICY_STAGE:
        action = str(payload.get("action") or "").strip()
        if action:
            return f"Schema drift policy: {action}"
        return "Schema drift policy applied"
    return None
