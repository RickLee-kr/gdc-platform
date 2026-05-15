"""Shared validation notification payload structure (English-only)."""

from __future__ import annotations

from typing import Any

from app.config import settings


def mask_url_for_log(url: str) -> str:
    """Best-effort redaction for webhook URLs in structured logs."""

    if "?" not in url:
        return url
    base, _q = url.split("?", 1)
    return f"{base}?********"


def build_ui_links(*, stream_id: int | None, route_id: int | None, run_id: str | None, validation_id: int) -> dict[str, str | None]:
    base = (settings.PLATFORM_PUBLIC_UI_BASE_URL or "").rstrip("/")
    prefix = f"{base}" if base else ""

    def p(path: str) -> str:
        return f"{prefix}{path}" if path.startswith("/") else f"{prefix}/{path}"

    out: dict[str, str | None] = {
        "validation_detail": p(f"/validation?highlight={validation_id}"),
        "validation_runs": p("/validation/runs"),
        "validation_alerts": p("/validation/alerts"),
    }
    if stream_id is not None:
        sid = int(stream_id)
        out["stream_runtime"] = p(f"/streams/{sid}/runtime")
        out["stream_analytics"] = p("/runtime/analytics")
        out["stream_health"] = p(f"/runtime/health/stream/{sid}")
        q = f"?stream_id={sid}"
        if run_id:
            q = f"?stream_id={sid}&run_id={run_id}"
        out["delivery_logs"] = p(f"/logs{q}")
    else:
        out["stream_runtime"] = None
        out["stream_analytics"] = p("/runtime/analytics")
        out["stream_health"] = None
        out["delivery_logs"] = p("/logs") if run_id is None else p(f"/logs?run_id={run_id}")

    if route_id is not None:
        rid = int(route_id)
        out["route_edit"] = p(f"/routes/{rid}/edit")
        out["delivery_logs_route"] = p(f"/logs?route_id={rid}")
    else:
        out["route_edit"] = None
        out["delivery_logs_route"] = None

    return out


def build_notification_payload(
    *,
    event_kind: str,
    validation_id: int,
    validation_name: str,
    validation_type: str,
    stream_id: int | None,
    stream_name: str | None,
    connector_name: str | None,
    severity: str,
    alert_type: str | None,
    last_error: str | None,
    consecutive_failures: int,
    run_id: str | None,
    validation_run_id: int | None,
    message: str,
    route_id: int | None = None,
) -> dict[str, Any]:
    """Structured JSON envelope for generic webhooks and channel adapters."""

    links = build_ui_links(stream_id=stream_id, route_id=route_id, run_id=run_id, validation_id=validation_id)
    return {
        "schema": "gdc.validation.alert/v1",
        "event_kind": event_kind,
        "operational_metadata": {
            "api_prefix": settings.API_PREFIX,
            "environment": settings.APP_ENV,
        },
        "validation": {
            "id": int(validation_id),
            "name": validation_name,
            "type": validation_type,
            "severity": severity,
            "alert_type": alert_type,
            "consecutive_failures": int(consecutive_failures),
            "last_error": last_error,
            "validation_run_id": validation_run_id,
            "run_id": run_id,
            "message": message,
        },
        "stream": {"id": stream_id, "name": stream_name},
        "connector": {"name": connector_name},
        "links": links,
    }
