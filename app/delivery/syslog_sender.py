"""Syslog delivery — UDP / TCP / TLS."""

from __future__ import annotations

import socket
import ssl
import threading
from typing import Any

from app.delivery.syslog_tls import SyslogTlsConfig, build_syslog_tls_context, normalize_syslog_tls_config
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.message_prefix import MessagePrefixResolveContext, format_delivery_lines_syslog
from app.runtime.errors import DestinationSendError


_tcp_pool_lock = threading.Lock()
_tcp_pool: dict[str, socket.socket] = {}


def _safe_close_socket(sock: socket.socket) -> None:
    close = getattr(sock, "close", None)
    if not callable(close):
        return
    try:
        close()
    except OSError:
        pass


def _borrow_tcp_socket(*, pool_key: str, host: str, port: int, timeout: float) -> socket.socket:
    with _tcp_pool_lock:
        sock = _tcp_pool.get(pool_key)
        if sock is not None:
            if isinstance(sock, socket.socket):
                try:
                    sock.getpeername()
                    return sock
                except OSError:
                    _tcp_pool.pop(pool_key, None)
                    _safe_close_socket(sock)
            else:
                _tcp_pool.pop(pool_key, None)
                _safe_close_socket(sock)
        sock = socket.create_connection((host, port), timeout=timeout)
        _tcp_pool[pool_key] = sock
        return sock


def _borrow_tls_socket(*, pool_key: str, tls_cfg: SyslogTlsConfig, ctx: ssl.SSLContext) -> ssl.SSLSocket:
    with _tcp_pool_lock:
        sock = _tcp_pool.get(pool_key)
        if sock is not None:
            if isinstance(sock, ssl.SSLSocket):
                try:
                    sock.getpeername()
                    return sock
                except OSError:
                    _tcp_pool.pop(pool_key, None)
                    _safe_close_socket(sock)
            else:
                _tcp_pool.pop(pool_key, None)
                _safe_close_socket(sock)
        raw_sock = socket.create_connection((tls_cfg.host, tls_cfg.port), timeout=tls_cfg.connect_timeout)
        try:
            tls_sock = ctx.wrap_socket(raw_sock, server_hostname=tls_cfg.server_name)
        except Exception:
            raw_sock.close()
            raise
        _tcp_pool[pool_key] = tls_sock
        return tls_sock


def _invalidate_tcp_socket(pool_key: str) -> None:
    with _tcp_pool_lock:
        sock = _tcp_pool.pop(pool_key, None)
    if sock is not None:
        _safe_close_socket(sock)


def _build_syslog_tls_pool_key(tls_cfg: SyslogTlsConfig) -> str:
    return (
        f"syslog-tls:{tls_cfg.host}:{tls_cfg.port}:"
        f"{tls_cfg.server_name}:{tls_cfg.verify_mode}:{tls_cfg.client_cert_path or ''}"
    )


def resolve_syslog_protocol(config: dict[str, Any], destination_type: str | None = None) -> str:
    """Pick UDP / TCP / TLS for syslog delivery.

    When ``destination_type`` is one of ``SYSLOG_TCP``/``SYSLOG_UDP``/``SYSLOG_TLS`` it is
    authoritative: the UI/DB kind must match the wire protocol (this fixes stale
    ``config_json.protocol`` values from older saves or type changes). Otherwise we fall
    back to ``config['protocol']`` and finally to UDP for backward compatibility.
    """

    dt = str(destination_type or "").upper()
    if dt == "SYSLOG_TCP":
        return "tcp"
    if dt == "SYSLOG_UDP":
        return "udp"
    if dt == "SYSLOG_TLS":
        return "tls"

    raw = config.get("protocol")
    if isinstance(raw, str) and raw.strip():
        p = raw.strip().lower()
        if p in {"udp", "tcp", "tls"}:
            return p
    return "udp"


class SyslogSender:
    """Transmit events to syslog destinations (UDP / TCP / TLS)."""

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        destination_type: str | None = None,
        *,
        prefix_context: MessagePrefixResolveContext | None = None,
    ) -> None:
        """Send all events to a syslog endpoint.

        Args:
            events: Enriched events.
            config: Destination config (host, port, optional protocol, formatter_config,
                and TLS keys when ``destination_type`` is ``SYSLOG_TLS``).
            formatter_override: Route-level ``formatter_config_json`` when non-empty.
            destination_type: For ``SYSLOG_*`` kinds, selects UDP/TCP/TLS and
                overrides a conflicting ``config['protocol']`` (stale JSON from older saves).
        """

        # StreamRunner skips calling send when extract_events returns []; keep guard for callers/tests.
        if not events:
            return

        protocol = resolve_syslog_protocol(config, destination_type)
        if protocol not in {"udp", "tcp", "tls"}:
            raise DestinationSendError(f"Unsupported syslog protocol: {protocol}")

        try:
            formatter_cfg = resolve_formatter_config(config, formatter_override)
            message_format = formatter_cfg.get("message_format", "json")
            if message_format != "json":
                raise ValueError(f"Unsupported message_format for syslog delivery: {message_format}")
            # Callers may omit ``destination_type`` (legacy); prefix defaults treat SYSLOG kinds alike.
            dt_for_prefix = str(destination_type or "").strip() or "SYSLOG_UDP"
            lines = format_delivery_lines_syslog(
                events,
                formatter_override,
                dt_for_prefix,
                prefix_context=prefix_context,
            )
        except ValueError as exc:
            raise DestinationSendError(str(exc)) from exc

        payloads = [line.encode("utf-8") for line in lines]

        if protocol == "tls":
            self._send_tls(payloads, config)
            return

        host = str(config.get("host", "")).strip()
        port = int(config.get("port", 514))
        timeout = float(config.get("timeout_seconds", 5))
        if not host:
            raise DestinationSendError("Syslog destination requires host")

        pool_key = f"syslog-tcp:{host}:{port}"
        try:
            if protocol == "udp":
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                    sock.settimeout(timeout)
                    for payload in payloads:
                        sock.sendto(payload, (host, port))
                return

            sock = _borrow_tcp_socket(pool_key=pool_key, host=host, port=port, timeout=timeout)
            for payload in payloads:
                sock.sendall(payload + b"\n")
        except OSError as exc:
            if protocol != "udp":
                _invalidate_tcp_socket(pool_key)
            raise DestinationSendError(f"Syslog send failed: {exc}") from exc

    def _send_tls(self, payloads: list[bytes], config: dict[str, Any]) -> None:
        """TLS-wrapped TCP delivery using a per-call ``ssl.SSLContext``.

        Connection or handshake failures map to :class:`DestinationSendError` so that
        the existing route failure policy (PAUSE/DISABLE/RETRY/LOG_AND_CONTINUE) handles
        them identically to plain TCP failures. Checkpoint semantics are unaffected.
        """

        try:
            tls_cfg = normalize_syslog_tls_config(config)
        except ValueError as exc:
            raise DestinationSendError(str(exc)) from exc

        try:
            ctx = build_syslog_tls_context(tls_cfg)
        except (FileNotFoundError, ssl.SSLError, OSError) as exc:
            raise DestinationSendError(f"Syslog TLS context error: {exc}") from exc

        pool_key = _build_syslog_tls_pool_key(tls_cfg)
        try:
            tls_sock = _borrow_tls_socket(pool_key=pool_key, tls_cfg=tls_cfg, ctx=ctx)
            tls_sock.settimeout(tls_cfg.write_timeout)
            for payload in payloads:
                tls_sock.sendall(payload + b"\n")
        except ssl.CertificateError as exc:
            _invalidate_tcp_socket(pool_key)
            raise DestinationSendError(f"Syslog TLS certificate error: {exc}") from exc
        except ssl.SSLError as exc:
            _invalidate_tcp_socket(pool_key)
            raise DestinationSendError(f"Syslog TLS handshake failed: {exc}") from exc
        except OSError as exc:
            _invalidate_tcp_socket(pool_key)
            raise DestinationSendError(f"Syslog TLS send failed: {exc}") from exc
