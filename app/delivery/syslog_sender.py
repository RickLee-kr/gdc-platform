"""Syslog delivery — UDP/TCP/TLS."""

from __future__ import annotations

import json
import socket
from typing import Any

from app.runtime.errors import DestinationSendError


class SyslogSender:
    """Transmit events to syslog destinations (UDP/TCP MVP)."""

    def send(self, events: list[dict[str, Any]], config: dict[str, Any]) -> None:
        """Send all events to a syslog endpoint.

        Args:
            events: Enriched events.
            config: Destination config (host, port, protocol).
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

        payloads = [json.dumps(event, ensure_ascii=True, separators=(",", ":")).encode("utf-8") for event in events]

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
