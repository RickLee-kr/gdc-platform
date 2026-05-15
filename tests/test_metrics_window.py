"""Unit tests for runtime metrics window parsing (no database)."""

from datetime import timedelta

import pytest

from app.runtime.metrics_window import (
    ALLOWED_WINDOWS,
    bucket_seconds_for_window,
    max_buckets_for_window,
    normalize_metrics_window_token,
    parse_metrics_window,
)


def test_parse_metrics_window_defaults() -> None:
    assert parse_metrics_window(None) == timedelta(hours=1)
    assert parse_metrics_window("bad") == timedelta(hours=1)


def test_normalize_token_ok() -> None:
    for tok in ALLOWED_WINDOWS:
        assert normalize_metrics_window_token(tok) == tok


def test_normalize_token_bad() -> None:
    with pytest.raises(ValueError):
        normalize_metrics_window_token("2h")


def test_bucket_sizes() -> None:
    assert bucket_seconds_for_window(timedelta(minutes=15)) == 60
    assert bucket_seconds_for_window(timedelta(hours=1)) == 150
    assert bucket_seconds_for_window(timedelta(hours=6)) == 900
    assert bucket_seconds_for_window(timedelta(hours=24)) == 3600


def test_max_buckets_cap() -> None:
    n = max_buckets_for_window(timedelta(hours=24), 3600)
    assert n == 24
