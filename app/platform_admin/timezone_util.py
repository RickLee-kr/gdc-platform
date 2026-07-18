"""IANA timezone validation for platform display settings."""

from __future__ import annotations

from functools import lru_cache

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

_NON_IANA_ALIASES = frozenset(
    {
        "KST",
        "JST",
        "EST",
        "EDT",
        "CST",
        "CDT",
        "MST",
        "MDT",
        "PST",
        "PDT",
        "BST",
    }
)


@lru_cache(maxsize=1)
def _iana_timezone_names() -> frozenset[str]:
    """Canonical IANA names from the system tzdb (includes UTC)."""
    names = set(available_timezones())
    names.add("UTC")
    return frozenset(names)


def validate_iana_timezone(raw: str) -> str:
    """
    Accept only IANA timezone names (and UTC).

    Rejects abbreviations and offsets such as KST, GMT+9, +09:00.
    """
    tz = (raw or "").strip()
    if not tz:
        raise ValueError("timezone is required")
    if tz == "UTC":
        return tz
    if tz.upper() in _NON_IANA_ALIASES:
        raise ValueError(f"invalid IANA timezone: {tz}")
    if tz.startswith(("GMT+", "GMT-", "UTC+", "UTC-")) or (
        len(tz) > 1 and tz[0] in "+-" and tz[1].isdigit()
    ):
        raise ValueError(f"invalid IANA timezone: {tz}")
    if tz not in _iana_timezone_names():
        raise ValueError(f"invalid IANA timezone: {tz}")
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"invalid IANA timezone: {tz}") from exc
    return tz
