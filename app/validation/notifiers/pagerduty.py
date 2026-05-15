"""PagerDuty Events API v2 compatible trigger payloads."""

from __future__ import annotations

from typing import Any


def body_for_pagerduty_v2(*, routing_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build JSON for POST https://events.pagerduty.com/v2/enqueue."""

    v = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}
    sev = str(v.get("severity") or "INFO").upper()
    pd_sev = "critical" if sev == "CRITICAL" else ("warning" if sev == "WARNING" else "info")
    summary = f"[GDC] {v.get('name') or 'validation'} — {payload.get('event_kind') or 'event'}"
    return {
        "routing_key": routing_key,
        "event_action": "trigger",
        "payload": {
            "summary": summary[:1024],
            "severity": pd_sev,
            "source": "gdc-platform/validation",
            "custom_details": payload,
        },
    }
