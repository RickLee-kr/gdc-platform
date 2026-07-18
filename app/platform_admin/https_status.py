"""Derive operator-facing HTTPS / certificate status from existing TLS + proxy signals."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from app.platform_admin.nginx_runtime import tls_ready_for_proxy

# Reuse Maintenance Health thresholds (TLS_CERT_EXPIRES_WITHIN_30D / 7D) — do not invent new policy.
TLS_CERT_EXPIRING_WITHIN_DAYS = 30

HttpsStatusCode = Literal[
    "enabled",
    "disabled",
    "certificate_missing",
    "certificate_invalid",
    "certificate_expiring",
    "configuration_error",
    "unknown",
]


def certificate_days_remaining(not_after: datetime | None, *, now: datetime | None = None) -> float | None:
    if not_after is None:
        return None
    ref = now or datetime.now(timezone.utc)
    expiry = not_after
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    else:
        expiry = expiry.astimezone(timezone.utc)
    return (expiry - ref.astimezone(timezone.utc)).total_seconds() / 86400.0


def compute_https_status(
    *,
    enabled: bool,
    cert_path: Path,
    key_path: Path,
    certificate_not_after: datetime | None,
    https_listener_active: bool,
    proxy_status: str,
    proxy_fallback_to_http: bool,
    now: datetime | None = None,
) -> tuple[HttpsStatusCode, float | None, bool, bool]:
    """Return ``(status, days_remaining, certificate_configured, private_key_configured)``."""

    cert_configured = cert_path.is_file()
    key_configured = key_path.is_file()
    days = certificate_days_remaining(certificate_not_after, now=now)

    if not enabled:
        return "disabled", days, cert_configured, key_configured

    if not cert_configured or not key_configured:
        return "certificate_missing", days, cert_configured, key_configured

    tls_ok, _msg = tls_ready_for_proxy(cert_path, key_path)
    if not tls_ok:
        return "certificate_invalid", days, cert_configured, key_configured

    if proxy_fallback_to_http or proxy_status == "degraded":
        return "configuration_error", days, cert_configured, key_configured

    if days is not None and days <= TLS_CERT_EXPIRING_WITHIN_DAYS:
        return "certificate_expiring", days, cert_configured, key_configured

    if https_listener_active:
        return "enabled", days, cert_configured, key_configured

    if proxy_status in {"unknown", "not_configured"} and not https_listener_active:
        return "unknown", days, cert_configured, key_configured

    # Enabled with valid cert but listener not confirmed yet.
    return "unknown", days, cert_configured, key_configured


def https_status_payload(
    *,
    enabled: bool,
    cert_path: Path,
    key_path: Path,
    certificate_not_after: datetime | None,
    https_listener_active: bool,
    proxy_status: str,
    proxy_fallback_to_http: bool,
) -> dict[str, Any]:
    status, days, cert_cfg, key_cfg = compute_https_status(
        enabled=enabled,
        cert_path=cert_path,
        key_path=key_path,
        certificate_not_after=certificate_not_after,
        https_listener_active=https_listener_active,
        proxy_status=proxy_status,
        proxy_fallback_to_http=proxy_fallback_to_http,
    )
    return {
        "https_status": status,
        "certificate_days_remaining": round(days, 2) if days is not None else None,
        "certificate_configured": cert_cfg,
        "private_key_configured": key_cfg,
    }
