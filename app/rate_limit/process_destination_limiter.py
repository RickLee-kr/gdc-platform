"""Process-wide destination rate limiter shared by runtime and replay (S4-15)."""

from __future__ import annotations

from app.rate_limit.destination_limiter import DestinationRateLimiter

_limiter = DestinationRateLimiter()


def get_process_destination_rate_limiter() -> DestinationRateLimiter:
    return _limiter


def reset_process_destination_rate_limiter_for_tests() -> None:
    global _limiter
    _limiter = DestinationRateLimiter()
