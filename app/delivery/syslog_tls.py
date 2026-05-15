"""Shared TLS context construction for SYSLOG_TLS sender + connectivity probe.

This module never opens connections by itself; it only normalizes destination
config keys into a configured ``ssl.SSLContext`` and a small dataclass with the
non-secret resolved fields used by the runtime sender and the probe. Sender
and probe both rely on this helper so verification semantics stay identical.
"""

from __future__ import annotations

import ssl
from dataclasses import dataclass
from typing import Any

DEFAULT_VERIFY_MODE = "strict"
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_WRITE_TIMEOUT = 5.0


@dataclass(frozen=True)
class SyslogTlsConfig:
    host: str
    port: int
    verify_mode: str
    server_name: str
    connect_timeout: float
    write_timeout: float
    ca_cert_path: str | None
    client_cert_path: str | None
    client_key_path: str | None


def normalize_syslog_tls_config(config: dict[str, Any]) -> SyslogTlsConfig:
    """Convert ``destinations.config_json`` into a normalized TLS config dataclass."""

    host = str(config.get("host", "")).strip()
    if not host:
        raise ValueError("SYSLOG_TLS destination requires host")

    port_raw = config.get("port")
    try:
        port = int(port_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("SYSLOG_TLS destination requires numeric port") from exc

    raw_mode = config.get("tls_verify_mode") or DEFAULT_VERIFY_MODE
    verify_mode = str(raw_mode).strip().lower() or DEFAULT_VERIFY_MODE
    if verify_mode not in ("strict", "insecure_skip_verify"):
        raise ValueError(f"Unsupported tls_verify_mode: {raw_mode!r}")

    server_name = str(config.get("tls_server_name") or host).strip() or host

    def _coerce_timeout(value: Any, default: float) -> float:
        if value is None:
            return default
        try:
            out = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("TLS timeout values must be numeric") from exc
        if out <= 0:
            raise ValueError("TLS timeout values must be positive")
        return out

    connect_timeout = _coerce_timeout(config.get("connect_timeout"), DEFAULT_CONNECT_TIMEOUT)
    write_timeout = _coerce_timeout(config.get("write_timeout"), DEFAULT_WRITE_TIMEOUT)

    ca_cert_path = config.get("tls_ca_cert_path") or None
    client_cert_path = config.get("tls_client_cert_path") or None
    client_key_path = config.get("tls_client_key_path") or None

    return SyslogTlsConfig(
        host=host,
        port=port,
        verify_mode=verify_mode,
        server_name=server_name,
        connect_timeout=connect_timeout,
        write_timeout=write_timeout,
        ca_cert_path=str(ca_cert_path) if ca_cert_path else None,
        client_cert_path=str(client_cert_path) if client_cert_path else None,
        client_key_path=str(client_key_path) if client_key_path else None,
    )


def build_syslog_tls_context(cfg: SyslogTlsConfig) -> ssl.SSLContext:
    """Build an ``ssl.SSLContext`` honoring verify mode + optional CA/client cert."""

    if cfg.verify_mode == "insecure_skip_verify":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    else:
        ctx = ssl.create_default_context(cafile=cfg.ca_cert_path) if cfg.ca_cert_path else ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED

    if cfg.client_cert_path and cfg.client_key_path:
        ctx.load_cert_chain(certfile=cfg.client_cert_path, keyfile=cfg.client_key_path)

    return ctx
