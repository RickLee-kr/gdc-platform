"""Slack-compatible incoming webhook payload (text + structured attachment fields)."""

from __future__ import annotations

import json
from typing import Any

from app.security.secrets import mask_secrets


def body_for_slack_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    """Minimal Slack incoming-webhook compatible JSON."""

    v = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}
    name = str(v.get("name") or "validation")
    sev = str(v.get("severity") or "INFO")
    msg = str(v.get("message") or "")
    lines = [
        f"*GDC Validation {payload.get('event_kind') or 'event'}*",
        f"*Validation*: `{name}` ({v.get('type')})",
        f"*Severity*: {sev}",
        f"*Consecutive failures*: {v.get('consecutive_failures')}",
    ]
    if v.get("run_id"):
        lines.append(f"*run_id*: `{v.get('run_id')}`")
    if v.get("last_error"):
        lines.append(f"*Last error*: {v.get('last_error')}")
    lines.append(f"*Detail*: {msg}")
    links = payload.get("links") if isinstance(payload.get("links"), dict) else {}
    if links.get("stream_runtime"):
        lines.append(f"*Stream*: {links.get('stream_runtime')}")
    if links.get("delivery_logs"):
        lines.append(f"*Logs*: {links.get('delivery_logs')}")
    text = "\n".join(lines)
    return {
        "text": text,
        "attachments": [
            {
                "color": "danger" if sev == "CRITICAL" else ("warning" if sev == "WARNING" else "#36a64f"),
                "mrkdwn_in": ["text", "fields"],
                "fallback": text,
                "fields": [
                    {
                        "title": "payload",
                        "value": f"```{json.dumps(mask_secrets(payload), default=str)[:3500]}```",
                    },
                ],
            }
        ],
    }
