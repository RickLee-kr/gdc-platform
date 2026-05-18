"""Validation helpers for published reverse-proxy network ports."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_HTTP_PORT = 18080
DEFAULT_HTTPS_PORT = 18443
MIN_TCP_PORT = 1
MAX_TCP_PORT = 65535

# Existing platform host-published ports and container-reserved service ports.
# Ports 80 and 443 intentionally remain allowed for production-style hosts.
RESERVED_PLATFORM_PORTS = frozenset({5432, 55432, 8000, 8080, 8099, 5514})


@dataclass(frozen=True)
class NetworkPortConfig:
    http_port: int
    https_port: int


class NetworkPortValidationError(ValueError):
    """Raised when reverse-proxy host port settings are invalid."""


def parse_tcp_port(value: object, *, field_name: str) -> int:
    """Parse a TCP port from API/env input without accepting compose mappings."""

    if isinstance(value, bool):
        raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")
    if isinstance(value, int):
        port = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw.isdigit():
            raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")
        port = int(raw, 10)
    else:
        raise NetworkPortValidationError(f"{field_name} must be a numeric TCP port.")

    if port < MIN_TCP_PORT or port > MAX_TCP_PORT:
        raise NetworkPortValidationError(f"{field_name} must be between 1 and 65535.")
    return port


def validate_network_ports(http_port: object, https_port: object) -> NetworkPortConfig:
    """Validate externally published HTTP/HTTPS reverse-proxy ports."""

    http = parse_tcp_port(http_port, field_name="http_port")
    https = parse_tcp_port(https_port, field_name="https_port")

    if http == https:
        raise NetworkPortValidationError("http_port and https_port cannot be identical.")

    for field_name, port in (("http_port", http), ("https_port", https)):
        if port in RESERVED_PLATFORM_PORTS:
            raise NetworkPortValidationError(
                f"{field_name} conflicts with a reserved platform service port ({port})."
            )

    return NetworkPortConfig(http_port=http, https_port=https)
