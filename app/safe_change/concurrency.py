"""Optional optimistic concurrency via existing ``updated_at`` columns."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def assert_base_updated_at_matches(*, current: datetime | None, base: datetime | None) -> None:
    """When ``base`` is provided, require it to match the row's ``updated_at``."""

    if base is None:
        return
    cur = _aware(current)
    expected = _aware(base)
    if cur is None:
        return
    if abs((cur - expected).total_seconds()) >= 0.001:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "STALE_CONFIGURATION",
                "message": "Configuration was changed by another session. Reload and review before applying.",
                "current_updated_at": cur.isoformat(),
            },
        )
