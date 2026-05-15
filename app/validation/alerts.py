"""Validation alert enums, fingerprints, and rule constants (English-only identifiers)."""

from __future__ import annotations

import hashlib
from typing import Literal

ValidationAlertStatus = Literal["OPEN", "ACKNOWLEDGED", "RESOLVED"]
ValidationAlertSeverity = Literal["INFO", "WARNING", "CRITICAL"]
ValidationAlertType = Literal[
    "AUTH_FAILURE",
    "DESTINATION_FAILURE",
    "CHECKPOINT_DRIFT",
    "DELIVERY_MISSING",
    "RETRY_EXHAUSTED",
    "VALIDATION_TIMEOUT",
    "VALIDATION_DEGRADED",
]

RecoveryCategory = Literal["AUTH", "DELIVERY", "CHECKPOINT", "GENERAL"]

CONSECUTIVE_FAIL_WARN_THRESHOLD = 3
CONSECUTIVE_FAIL_CRITICAL_THRESHOLD = 5
PROLONGED_FAILING_SECONDS = 3600
NOTIFICATION_BACKOFF_SEC = (1.0, 4.0, 12.0)
HTTP_NOTIFY_TIMEOUT_SEC = 8.0


def fingerprint_for(validation_id: int, alert_type: str, suffix: str = "") -> str:
    raw = f"{int(validation_id)}:{alert_type}:{suffix}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def cap_severity_for_overall(overall: str, severity: ValidationAlertSeverity) -> ValidationAlertSeverity:
    """WARN-only runs must not emit CRITICAL alerts."""

    if overall == "WARN" and severity == "CRITICAL":
        return "WARNING"
    return severity
