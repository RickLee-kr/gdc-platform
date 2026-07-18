"""Unit tests for HTTPS status derivation (reuses maintenance expiry threshold)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.platform_admin.https_status import (
    TLS_CERT_EXPIRING_WITHIN_DAYS,
    compute_https_status,
)


def test_disabled_when_https_off(tmp_path: Path) -> None:
    status, days, _, _ = compute_https_status(
        enabled=False,
        cert_path=tmp_path / "c.crt",
        key_path=tmp_path / "k.key",
        certificate_not_after=None,
        https_listener_active=False,
        proxy_status="ok",
        proxy_fallback_to_http=False,
    )
    assert status == "disabled"
    assert days is None


def test_missing_certificate(tmp_path: Path) -> None:
    status, _, cert_cfg, key_cfg = compute_https_status(
        enabled=True,
        cert_path=tmp_path / "missing.crt",
        key_path=tmp_path / "missing.key",
        certificate_not_after=None,
        https_listener_active=False,
        proxy_status="ok",
        proxy_fallback_to_http=False,
    )
    assert status == "certificate_missing"
    assert cert_cfg is False
    assert key_cfg is False


def test_expiring_uses_maintenance_30d_threshold(tmp_path: Path, monkeypatch) -> None:
    cert = tmp_path / "c.crt"
    key = tmp_path / "k.key"
    cert.write_text("x")
    key.write_text("y")
    monkeypatch.setattr(
        "app.platform_admin.https_status.tls_ready_for_proxy",
        lambda *_a, **_k: (True, ""),
    )
    not_after = datetime.now(timezone.utc) + timedelta(days=10)
    status, days, _, _ = compute_https_status(
        enabled=True,
        cert_path=cert,
        key_path=key,
        certificate_not_after=not_after,
        https_listener_active=True,
        proxy_status="ok",
        proxy_fallback_to_http=False,
    )
    assert TLS_CERT_EXPIRING_WITHIN_DAYS == 30
    assert status == "certificate_expiring"
    assert days is not None and days <= 30


def test_configuration_error_on_proxy_fallback(tmp_path: Path, monkeypatch) -> None:
    cert = tmp_path / "c.crt"
    key = tmp_path / "k.key"
    cert.write_text("x")
    key.write_text("y")
    monkeypatch.setattr(
        "app.platform_admin.https_status.tls_ready_for_proxy",
        lambda *_a, **_k: (True, ""),
    )
    status, _, _, _ = compute_https_status(
        enabled=True,
        cert_path=cert,
        key_path=key,
        certificate_not_after=datetime.now(timezone.utc) + timedelta(days=200),
        https_listener_active=False,
        proxy_status="degraded",
        proxy_fallback_to_http=True,
    )
    assert status == "configuration_error"


def test_enabled_healthy(tmp_path: Path, monkeypatch) -> None:
    cert = tmp_path / "c.crt"
    key = tmp_path / "k.key"
    cert.write_text("x")
    key.write_text("y")
    monkeypatch.setattr(
        "app.platform_admin.https_status.tls_ready_for_proxy",
        lambda *_a, **_k: (True, ""),
    )
    status, days, cert_cfg, key_cfg = compute_https_status(
        enabled=True,
        cert_path=cert,
        key_path=key,
        certificate_not_after=datetime.now(timezone.utc) + timedelta(days=200),
        https_listener_active=True,
        proxy_status="ok",
        proxy_fallback_to_http=False,
    )
    assert status == "enabled"
    assert cert_cfg and key_cfg
    assert days is not None and days > 30
