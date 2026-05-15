"""Render nginx reverse-proxy config and trigger in-container reload (optional)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import settings
from app.platform_admin.cert_service import verify_tls_pem_pair


def _resolve_conf_path() -> Path:
    p = Path(settings.GDC_NGINX_CONF_PATH).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p


def _upstream_proxy_pass() -> str:
    host = settings.GDC_UPSTREAM_API_HOST.strip() or "127.0.0.1"
    port = int(settings.GDC_UPSTREAM_API_PORT or 8000)
    return f"http://{host}:{port}"


def _upstream_ui_proxy_pass() -> str:
    host = (settings.GDC_UPSTREAM_UI_HOST or "frontend").strip() or "frontend"
    port = int(settings.GDC_UPSTREAM_UI_PORT or 80)
    return f"http://{host}:{port}"


def _https_redirect_target() -> str:
    """Return the ``https://`` prefix + host variable fragment for ``return 301``."""

    hp = int(settings.GDC_PUBLIC_HTTPS_PORT or 0)
    if hp in (0, 443):
        return "https://$host"
    return f"https://$host:{hp}"


def _proxy_common_directives() -> str:
    return (
        "    proxy_http_version 1.1;\n"
        "    proxy_set_header Host $host;\n"
        "    proxy_set_header X-Real-IP $remote_addr;\n"
        "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "    proxy_set_header X-Forwarded-Proto $scheme;\n"
        "    proxy_set_header Upgrade $http_upgrade;\n"
        "    proxy_set_header Connection $connection_upgrade;\n"
        "    proxy_read_timeout 300s;\n"
        "    proxy_send_timeout 300s;\n"
    )


def _location_blocks() -> str:
    common = _proxy_common_directives()
    return (
        "    location /api/ {\n"
        f"{common}"
        "        proxy_pass $gdc_api_upstream;\n"
        "    }\n"
        "    location /health {\n"
        f"{common}"
        "        proxy_pass $gdc_api_upstream;\n"
        "    }\n"
        "    location /assets/ {\n"
        f"{common}"
        "        proxy_pass $gdc_ui_upstream;\n"
        "    }\n"
        "    location / {\n"
        f"{common}"
        "        proxy_pass $gdc_ui_upstream;\n"
        "    }\n"
    )


def render_nginx_site_conf(
    *,
    tls_enabled: bool,
    redirect_http_to_https: bool,
    cert_container_path: str,
    key_container_path: str,
) -> str:
    """Return a full ``server { ... }`` style config file body (one or more server blocks)."""

    base = _upstream_proxy_pass()
    ui_base = _upstream_ui_proxy_pass()
    location = _location_blocks()

    blocks: list[str] = ["resolver 127.0.0.11 ipv6=off valid=10s;\n"]

    if tls_enabled and redirect_http_to_https:
        target = _https_redirect_target()
        blocks.append(
            "server {\n"
            "    listen 80 default_server;\n"
            "    listen [::]:80 default_server;\n"
            f"    return 301 {target}$request_uri;\n"
            "}\n"
        )
    else:
        blocks.append(
            "server {\n"
            "    listen 80 default_server;\n"
            "    listen [::]:80 default_server;\n"
            f"    set $gdc_api_upstream {base};\n"
            f"    set $gdc_ui_upstream {ui_base};\n"
            f"{location}"
            "}\n"
        )

    if tls_enabled:
        blocks.append(
            "server {\n"
            "    listen 443 ssl default_server;\n"
            "    listen [::]:443 ssl default_server;\n"
            f"    set $gdc_api_upstream {base};\n"
            f"    set $gdc_ui_upstream {ui_base};\n"
            f"    ssl_certificate {cert_container_path};\n"
            f"    ssl_certificate_key {key_container_path};\n"
            "    ssl_session_cache shared:SSL:10m;\n"
            "    ssl_session_timeout 10m;\n"
            f"{location}"
            "}\n"
        )

    return "".join(blocks)


def tls_ready_for_proxy(cert_host_path: Path, key_host_path: Path) -> tuple[bool, str]:
    if not cert_host_path.is_file() or not key_host_path.is_file():
        return False, "certificate or key file missing"
    return verify_tls_pem_pair(cert_host_path, key_host_path)


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


@dataclass(frozen=True)
class NginxApplyOutcome:
    wrote_config: bool
    used_https_block: bool
    effective_redirect: bool
    reload_ok: bool
    reload_detail: str
    fell_back_to_http: bool


def reload_proxy_via_http() -> tuple[bool, str]:
    url = (settings.GDC_PROXY_RELOAD_URL or "").strip()
    if not url:
        return False, "GDC_PROXY_RELOAD_URL is not set"
    token = (settings.GDC_PROXY_RELOAD_TOKEN or "").strip()
    if not token:
        return False, "GDC_PROXY_RELOAD_TOKEN is not set"
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"action": "reload"},
            )
    except Exception as exc:
        return False, f"reload request failed: {exc}"
    if r.status_code >= 400:
        return False, f"reload HTTP {r.status_code}: {r.text[:500]}"
    return True, (r.text or "ok")[:500]


def apply_nginx_runtime(
    *,
    desired_https: bool,
    desired_redirect: bool,
    cert_host_path: Path,
    key_host_path: Path,
) -> NginxApplyOutcome:
    """Write nginx config and reload. On reload failure after enabling TLS, fall back to HTTP-only."""

    conf_path = _resolve_conf_path()
    cert_in = (settings.GDC_NGINX_TLS_CERT_CONTAINER_PATH or "/var/gdc/tls/server.crt").strip()
    key_in = (settings.GDC_NGINX_TLS_KEY_CONTAINER_PATH or "/var/gdc/tls/server.key").strip()

    tls_ok, _tls_msg = (
        tls_ready_for_proxy(cert_host_path, key_host_path) if desired_https else (False, "")
    )
    use_tls = bool(desired_https and tls_ok)
    effective_redirect = bool(use_tls and desired_redirect)

    primary = render_nginx_site_conf(
        tls_enabled=use_tls,
        redirect_http_to_https=effective_redirect,
        cert_container_path=cert_in,
        key_container_path=key_in,
    )
    write_atomic(conf_path, primary)
    if not (settings.GDC_PROXY_RELOAD_URL or "").strip():
        return NginxApplyOutcome(
            wrote_config=True,
            used_https_block=use_tls,
            effective_redirect=effective_redirect,
            reload_ok=True,
            reload_detail="nginx config written; GDC_PROXY_RELOAD_URL not set (reload the proxy manually to apply)",
            fell_back_to_http=False,
        )

    ok, detail = reload_proxy_via_http()
    fell_back = False

    if not ok and use_tls:
        fallback = render_nginx_site_conf(
            tls_enabled=False,
            redirect_http_to_https=False,
            cert_container_path=cert_in,
            key_container_path=key_in,
        )
        write_atomic(conf_path, fallback)
        ok2, detail2 = reload_proxy_via_http()
        fell_back = True
        return NginxApplyOutcome(
            wrote_config=True,
            used_https_block=False,
            effective_redirect=False,
            reload_ok=ok2,
            reload_detail=f"tls reload failed ({detail}); fell back to HTTP-only: {detail2}",
            fell_back_to_http=True,
        )

    return NginxApplyOutcome(
        wrote_config=True,
        used_https_block=use_tls,
        effective_redirect=effective_redirect,
        reload_ok=ok,
        reload_detail=detail,
        fell_back_to_http=fell_back,
    )


def probe_proxy_health() -> tuple[bool, str]:
    url = (settings.GDC_PROXY_INTERNAL_HEALTH_URL or "").strip()
    if not url:
        return False, "not_configured"
    try:
        with httpx.Client(timeout=3.0) as client:
            r = client.get(url)
    except Exception as exc:
        return False, str(exc)
    if r.status_code >= 400:
        return False, f"HTTP {r.status_code}"
    return True, "ok"
