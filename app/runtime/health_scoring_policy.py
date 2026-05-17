"""Operational health scoring exclusions (explicit, traceable).

Streams may set ``exclude_from_health_scoring`` or ``validation_expected_failure`` in
``config_json`` to keep delivery logs/events while omitting them from health aggregates.
"""

from __future__ import annotations

from typing import Any

EXCLUDE_FROM_HEALTH_SCORING_KEY = "exclude_from_health_scoring"
VALIDATION_EXPECTED_FAILURE_KEY = "validation_expected_failure"


def stream_config_excluded_from_health_scoring(config_json: dict[str, Any] | None) -> bool:
    cfg = config_json if isinstance(config_json, dict) else {}
    if cfg.get(EXCLUDE_FROM_HEALTH_SCORING_KEY) is True:
        return True
    if cfg.get(VALIDATION_EXPECTED_FAILURE_KEY) is True:
        return True
    return False


__all__ = [
    "EXCLUDE_FROM_HEALTH_SCORING_KEY",
    "VALIDATION_EXPECTED_FAILURE_KEY",
    "stream_config_excluded_from_health_scoring",
]
