"""Schema Drift Policy delivery_logs persistence."""

from __future__ import annotations

from app.schema_drift_policy.delivery_log_stages import (
    SCHEMA_DRIFT_POLICY_AUTO_PROTECT_APPLIED_STAGE,
    SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES,
    schema_drift_policy_delivery_log_message,
)


def test_schema_drift_delivery_log_stages_include_runtime_tokens() -> None:
    assert SCHEMA_DRIFT_POLICY_AUTO_PROTECT_APPLIED_STAGE in SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES
    assert "schema_drift_policy_review_required" in SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES
    assert "schema_drift_policy_path_resolution_failed" in SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES
    assert "schema_drift_policy" in SCHEMA_DRIFT_POLICY_DELIVERY_LOG_STAGES


def test_schema_drift_delivery_log_message_auto_protect() -> None:
    msg = schema_drift_policy_delivery_log_message(
        {
            "stage": "schema_drift_policy_auto_protect_applied",
            "field_path": "$.email",
            "protection_mode": "partial_mask",
        }
    )
    assert msg == "Auto protect applied: $.email (partial_mask)"


def test_schema_drift_delivery_log_message_review_required() -> None:
    msg = schema_drift_policy_delivery_log_message(
        {
            "stage": "schema_drift_policy_review_required",
            "field_path": "$.nickname",
            "policy_type": "unknown_normal",
        }
    )
    assert msg == "Schema drift policy review required: $.nickname (unknown_normal)"


def test_schema_drift_delivery_log_message_path_resolution_failed() -> None:
    msg = schema_drift_policy_delivery_log_message(
        {
            "stage": "schema_drift_policy_path_resolution_failed",
            "extracted_path": "$.missing.path",
        }
    )
    assert msg == "Schema drift path resolution failed: $.missing.path"


def test_schema_drift_delivery_log_message_quarantine() -> None:
    msg = schema_drift_policy_delivery_log_message(
        {
            "stage": "schema_drift_policy",
            "action": "quarantine",
        }
    )
    assert msg == "Schema drift policy: quarantine"
