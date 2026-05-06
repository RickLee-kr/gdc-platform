"""Syslog preview formatter utilities."""

from __future__ import annotations

import json
from typing import Any

FACILITY_MAP = {
    "local0": 16,
}

SEVERITY_MAP = {
    "info": 6,
}

_SYSLOG_FIELD_KEYS = ("facility", "severity", "hostname", "app_name", "tag")

_DEFAULT_SYSLOG_FIELDS: dict[str, str] = {
    "facility": "local0",
    "severity": "info",
    "hostname": "gdc",
    "app_name": "generic-connector",
    "tag": "event",
}


def format_syslog(event: dict[str, Any], formatter_config: dict[str, Any]) -> str:
    """Build a syslog-like preview message from a single event."""

    message_format = formatter_config.get("message_format", "json")
    if message_format != "json":
        raise ValueError("Only message_format='json' is supported")

    syslog_nested = formatter_config.get("syslog")
    if syslog_nested is not None and not isinstance(syslog_nested, dict):
        raise ValueError("formatter_config.syslog must be an object when provided")

    merged = dict(_DEFAULT_SYSLOG_FIELDS)
    for key in _SYSLOG_FIELD_KEYS:
        if key in formatter_config:
            merged[key] = formatter_config[key]
    if isinstance(syslog_nested, dict):
        for key in _SYSLOG_FIELD_KEYS:
            if key in syslog_nested:
                merged[key] = syslog_nested[key]

    facility_name = str(merged["facility"]).lower()
    severity_name = str(merged["severity"]).lower()
    hostname = str(merged["hostname"])
    app_name = str(merged["app_name"])
    tag = str(merged["tag"])

    facility = FACILITY_MAP.get(facility_name)
    severity = SEVERITY_MAP.get(severity_name)
    if facility is None or severity is None:
        raise ValueError("Unsupported facility or severity")

    pri = facility * 8 + severity
    payload = json.dumps(event, separators=(",", ":"))
    return f"<{pri}> {hostname} {app_name} {tag}: {payload}"
