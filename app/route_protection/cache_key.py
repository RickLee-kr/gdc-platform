"""Batch-local protection execution cache key (Route Processing ON reuse)."""

from __future__ import annotations

import json
from typing import Any

from app.route_protection.config import RouteProtectionConfig


def protection_execution_cache_key(
    *,
    transform_key: str,
    config: RouteProtectionConfig,
    merged_ephemeral: list[Any],
) -> str:
    """Stable identity for identical effective protection + transform input.

    Key is based on values that determine ``protect_batch`` output, not route id.
    ``transform_key`` scopes reuse to routes that share the same pre-protection events.
    """

    rules_payload = sorted(
        (
            {
                "stream_id": int(rule.stream_id),
                "field_path": str(rule.field_path),
                "protection_mode": str(rule.protection_mode),
                "sensitivity_class": str(rule.sensitivity_class),
                "enabled": bool(rule.enabled),
            }
            for rule in config.rules
        ),
        key=lambda item: item["field_path"],
    )
    ephemeral_payload = sorted(
        (
            {
                "stream_id": int(getattr(rule, "stream_id", 0) or 0),
                "field_path": str(getattr(rule, "field_path", "") or ""),
                "protection_mode": str(getattr(rule, "protection_mode", "") or ""),
                "sensitivity_class": str(getattr(rule, "sensitivity_class", "") or ""),
                "enabled": bool(getattr(rule, "enabled", True)),
            }
            for rule in merged_ephemeral
        ),
        key=lambda item: item["field_path"],
    )
    payload = {
        "transform_key": transform_key,
        "rules": rules_payload,
        "ephemeral": ephemeral_payload,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))
