"""Schema Drift Policy config validation and defaults."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

UNKNOWN_NORMAL_POLICIES = frozenset({"pass_through", "require_review", "quarantine"})
UNKNOWN_SENSITIVE_POLICIES = frozenset({"auto_protect", "require_review", "quarantine"})

DEFAULT_UNKNOWN_NORMAL_POLICY = "pass_through"
DEFAULT_UNKNOWN_SENSITIVE_POLICY = "auto_protect"


@dataclass(frozen=True, slots=True)
class SchemaDriftPolicyConfig:
    unknown_normal_field_policy: str = DEFAULT_UNKNOWN_NORMAL_POLICY
    unknown_sensitive_field_policy: str = DEFAULT_UNKNOWN_SENSITIVE_POLICY


DEFAULT_SCHEMA_DRIFT_POLICY = SchemaDriftPolicyConfig()


def _normalize_normal(value: Any) -> str:
    raw = str(value).strip() if value is not None else ""
    if raw in UNKNOWN_NORMAL_POLICIES:
        return raw
    return DEFAULT_UNKNOWN_NORMAL_POLICY


def _normalize_sensitive(value: Any) -> str:
    raw = str(value).strip() if value is not None else ""
    if raw in UNKNOWN_SENSITIVE_POLICIES:
        return raw
    return DEFAULT_UNKNOWN_SENSITIVE_POLICY


def normalize_schema_drift_policy(raw: dict[str, Any] | None) -> SchemaDriftPolicyConfig:
    """Normalize stored or incoming policy dict to allowed enum values."""

    doc = raw if isinstance(raw, dict) else {}
    return SchemaDriftPolicyConfig(
        unknown_normal_field_policy=_normalize_normal(doc.get("unknown_normal_field_policy")),
        unknown_sensitive_field_policy=_normalize_sensitive(doc.get("unknown_sensitive_field_policy")),
    )


def load_schema_drift_policy(config_json: dict[str, Any] | None) -> SchemaDriftPolicyConfig:
    """Load policy from ``streams.config_json.governance.schema_drift_policy``."""

    root = config_json if isinstance(config_json, dict) else {}
    governance = root.get("governance")
    if not isinstance(governance, dict):
        return DEFAULT_SCHEMA_DRIFT_POLICY
    raw_policy = governance.get("schema_drift_policy")
    if not isinstance(raw_policy, dict):
        return DEFAULT_SCHEMA_DRIFT_POLICY
    return normalize_schema_drift_policy(raw_policy)


def validate_schema_drift_policy_payload(raw: dict[str, Any] | None) -> dict[str, str] | None:
    """Return normalized persist payload or None when absent."""

    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("schema_drift_policy must be an object")
    normal = raw.get("unknown_normal_field_policy", DEFAULT_UNKNOWN_NORMAL_POLICY)
    sensitive = raw.get("unknown_sensitive_field_policy", DEFAULT_UNKNOWN_SENSITIVE_POLICY)
    if str(normal).strip() not in UNKNOWN_NORMAL_POLICIES:
        raise ValueError(f"invalid unknown_normal_field_policy: {normal!r}")
    if str(sensitive).strip() not in UNKNOWN_SENSITIVE_POLICIES:
        raise ValueError(f"invalid unknown_sensitive_field_policy: {sensitive!r}")
    return {
        "unknown_normal_field_policy": str(normal).strip(),
        "unknown_sensitive_field_policy": str(sensitive).strip(),
    }


def merge_governance_schema_drift_policy(
    config_json: dict[str, Any] | None,
    policy_payload: dict[str, str],
) -> dict[str, Any]:
    """Merge policy into config_json preserving other governance keys."""

    merged = dict(config_json or {})
    governance = dict(merged.get("governance") or {}) if isinstance(merged.get("governance"), dict) else {}
    governance["schema_drift_policy"] = dict(policy_payload)
    merged["governance"] = governance
    return merged
