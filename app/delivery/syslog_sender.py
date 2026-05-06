"""Syslog delivery — UDP/TCP/TLS."""

from __future__ import annotations

import socket
from typing import Any

from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.syslog_formatter import format_syslog
from app.runtime.errors import DestinationSendError


class SyslogSender:
    """Transmit events to syslog destinations (UDP/TCP MVP)."""

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
    ) -> None:
        """Send all events to a syslog endpoint.

        Args:
            events: Enriched events.
            config: Destination config (host, port, protocol, optional formatter_config).
            formatter_override: Route-level ``formatter_config_json`` when non-empty.
        """

        if not events:
            return

        host = str(config.get("host", "")).strip()
        port = int(config.get("port", 514))
        protocol = str(config.get("protocol", "udp")).lower()
        timeout = float(config.get("timeout_seconds", 5))

        if not host:
            raise DestinationSendError("Syslog destination requires host")
        if protocol not in {"udp", "tcp"}:
            raise DestinationSendError(f"Unsupported syslog protocol: {protocol}")

        try:
            formatter_cfg = resolve_formatter_config(config, formatter_override)
            lines = [format_syslog(event, formatter_cfg) for event in events]
        except ValueError as exc:
            raise DestinationSendError(str(exc)) from exc

        payloads = [line.encode("utf-8") for line in lines]

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
