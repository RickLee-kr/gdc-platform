"""Input validation for HTTPS SAN lists and usernames."""

from __future__ import annotations

import ipaddress
import re

_DNS_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$"
)


def normalize_username(value: str) -> str:
    u = value.strip()
    if not u or " " in u:
        raise ValueError("username must be non-empty and must not contain spaces")
    return u


def validate_ip_sans(values: list[str]) -> list[str]:
    out: list[str] = []
    for raw in values:
        s = raw.strip()
        if not s:
            continue
        try:
            ipaddress.ip_address(s)
        except ValueError as exc:
            raise ValueError(f"invalid IP address in SAN list: {raw!r}") from exc
        out.append(s)
    return out


def validate_dns_sans(values: list[str]) -> list[str]:
    out: list[str] = []
    for raw in values:
        s = raw.strip().lower()
        if not s:
            continue
        if not _DNS_RE.match(s):
            raise ValueError(f"invalid DNS name in SAN list: {raw!r}")
        out.append(s)
    return out
