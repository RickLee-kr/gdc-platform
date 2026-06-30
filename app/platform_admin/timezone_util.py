"""IANA timezone validation for platform display settings."""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def validate_iana_timezone(raw: str) -> str:
    tz = (raw or "").strip()
    if not tz:
        raise ValueError("timezone is required")
    if tz == "UTC":
        return tz
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"invalid IANA timezone: {tz}") from exc
    return tz
