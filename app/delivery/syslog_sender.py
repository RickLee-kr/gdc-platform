"""Syslog delivery — UDP / TCP / TLS."""

from __future__ import annotations

import socket
import ssl
from typing import Any

from app.delivery.syslog_tls import build_syslog_tls_context, normalize_syslog_tls_config
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.message_prefix import MessagePrefixResolveContext, format_delivery_lines_syslog
from app.runtime.errors import DestinationSendError


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

        try:
            if protocol == "udp":
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                    sock.settimeout(timeout)
                    for payload in payloads:
                        sock.sendto(payload, (host, port))
                return

            with socket.create_connection((host, port), timeout=timeout) as sock:
                for payload in payloads:
                    sock.sendall(payload + b"\n")
        except OSError as exc:
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

        try:
            raw_sock = socket.create_connection((tls_cfg.host, tls_cfg.port), timeout=tls_cfg.connect_timeout)
        except OSError as exc:
            raise DestinationSendError(f"Syslog TLS connect failed: {exc}") from exc

        try:
            tls_sock = ctx.wrap_socket(raw_sock, server_hostname=tls_cfg.server_name)
        except ssl.CertificateError as exc:
            raw_sock.close()
            raise DestinationSendError(f"Syslog TLS certificate error: {exc}") from exc
        except ssl.SSLError as exc:
            raw_sock.close()
            raise DestinationSendError(f"Syslog TLS handshake failed: {exc}") from exc
        except OSError as exc:
            raw_sock.close()
            raise DestinationSendError(f"Syslog TLS handshake failed: {exc}") from exc

        try:
            tls_sock.settimeout(tls_cfg.write_timeout)
            for payload in payloads:
                tls_sock.sendall(payload + b"\n")
        except OSError as exc:
            raise DestinationSendError(f"Syslog TLS send failed: {exc}") from exc
        finally:
            try:
                tls_sock.close()
            except OSError:  # pragma: no cover - defensive close path
                pass
