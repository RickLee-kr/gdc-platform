"""Parse runtime metrics time-window query parameters (15m, 1h, 6h, 24h)."""

from __future__ import annotations

from datetime import timedelta

ALLOWED_WINDOWS = frozenset({"15m", "1h", "6h", "24h"})


def parse_metrics_window(window: str | None) -> timedelta:
    """Return a non-negative timedelta for supported window tokens."""

    key = (window or "1h").strip().lower()
    mapping = {
        "15m": timedelta(minutes=15),
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "24h": timedelta(hours=24),
    }
    if key not in mapping:
        return mapping["1h"]
    return mapping[key]


def normalize_metrics_window_token(window: str | None) -> str:
    """Validate window token; raises ValueError when unsupported."""

    key = (window or "1h").strip().lower()
    if key not in ALLOWED_WINDOWS:
        raise ValueError(f"unsupported metrics window: {window!r} (use 15m, 1h, 6h, 24h)")
    return key


def bucket_seconds_for_window(td: timedelta) -> int:
    """Choose aggregation bucket size (seconds) to cap series length without huge scans."""

    total_sec = int(td.total_seconds())
    if total_sec <= 15 * 60:
        return 60
    if total_sec <= 3600:
        # 24 buckets per hour for chart density (3600 / 150 == 24).
        return 150
    if total_sec <= 6 * 3600:
        return 900
    return 3600


def max_buckets_for_window(td: timedelta, bucket_sec: int) -> int:
    """Upper bound on buckets; aligns with window / bucket ratio."""

    span = max(1, int(td.total_seconds()))
    return min(256, max(1, (span + bucket_sec - 1) // bucket_sec))
