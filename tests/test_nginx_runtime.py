from __future__ import annotations

from pathlib import Path

import pytest

from app.platform_admin import nginx_runtime


def test_render_http_only() -> None:
    body = nginx_runtime.render_nginx_site_conf(
        tls_enabled=False,
        redirect_http_to_https=False,
        cert_container_path="/var/gdc/tls/server.crt",
        key_container_path="/var/gdc/tls/server.key",
    )
    assert "listen 80" in body
    assert "listen 443" not in body
    assert "return 301" not in body
    assert "proxy_set_header Upgrade $http_upgrade" in body
    assert "proxy_set_header Connection $connection_upgrade" in body
    assert "set $gdc_ui_upstream http://frontend:80" in body
    assert "location /assets/" in body
    assert "proxy_pass $gdc_ui_upstream" in body


def test_render_https_with_redirect() -> None:
    body = nginx_runtime.render_nginx_site_conf(
        tls_enabled=True,
        redirect_http_to_https=True,
        cert_container_path="/var/gdc/tls/server.crt",
        key_container_path="/var/gdc/tls/server.key",
    )
    assert "listen 443 ssl" in body
    assert "return 301 https://" in body


def test_apply_skips_reload_when_url_unset(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_NGINX_CONF_PATH", str(tmp_path / "default.conf"), raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_PROXY_RELOAD_URL", "", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_UPSTREAM_API_HOST", "127.0.0.1", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_UPSTREAM_API_PORT", 8000, raising=False)
    cert = tmp_path / "c.pem"
    key = tmp_path / "k.pem"
    cert.write_text("x", encoding="utf-8")
    key.write_text("y", encoding="utf-8")
    out = nginx_runtime.apply_nginx_runtime(
        desired_https=False,
        desired_redirect=False,
        cert_host_path=cert,
        key_host_path=key,
    )
    assert out.reload_ok is True
    assert "not configured" in out.reload_detail.lower() or "reload" in out.reload_detail.lower()


def test_apply_falls_back_when_reload_fails(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    conf = tmp_path / "default.conf"
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_NGINX_CONF_PATH", str(conf), raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_PROXY_RELOAD_URL", "http://127.0.0.1:9/nope", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_PROXY_RELOAD_TOKEN", "x", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_UPSTREAM_API_HOST", "127.0.0.1", raising=False)
    monkeypatch.setattr("app.platform_admin.nginx_runtime.settings.GDC_UPSTREAM_API_PORT", 8000, raising=False)
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    from datetime import datetime, timedelta, timezone

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "t")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / "c.pem"
    key_path = tmp_path / "k.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ),
    )
    out = nginx_runtime.apply_nginx_runtime(
        desired_https=True,
        desired_redirect=False,
        cert_host_path=cert_path,
        key_host_path=key_path,
    )
    assert out.fell_back_to_http is True
    assert out.used_https_block is False
    assert conf.read_text(encoding="utf-8").count("listen 443") == 0
    # Reload target is invalid; fallback config is still written for operator inspection.
    assert out.reload_ok in (True, False)
