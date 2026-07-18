"""Lab S3 checkpoint sync must not wipe healthy delivery cursors."""

from __future__ import annotations

from app.dev_validation_lab.lab_throughput_sync import (
    _lab_s3_checkpoint_is_stale_empty_key,
    _lab_s3_checkpoint_needs_high_water_reset,
)


def test_healthy_s3_checkpoint_is_not_reset() -> None:
    current = {
        "last_processed_key": "e2e-s3/lab-active/lab-feed-1.ndjson",
        "last_processed_last_modified": "2026-07-08T11:00:00Z",
        "last_success_event": {"s3_key": "e2e-s3/lab-active/lab-feed-1.ndjson"},
    }
    assert _lab_s3_checkpoint_needs_high_water_reset(current) is False
    assert _lab_s3_checkpoint_is_stale_empty_key(current) is False


def test_empty_checkpoint_needs_high_water() -> None:
    assert _lab_s3_checkpoint_needs_high_water_reset({}) is True


def test_corrupt_empty_key_with_success_event_is_repairable() -> None:
    current = {
        "last_processed_key": "",
        "last_processed_last_modified": "2026-07-08T11:00:00Z",
        "last_success_event": {
            "s3_key": "e2e-s3/lab-active/lab-feed-1.ndjson",
            "s3_last_modified": "2026-07-08T11:00:00Z",
        },
    }
    assert _lab_s3_checkpoint_is_stale_empty_key(current) is True
    # Not treated as "needs high water wipe" — repair path owns this shape.
    assert _lab_s3_checkpoint_needs_high_water_reset(current) is False


def test_time_only_high_water_is_left_alone() -> None:
    current = {
        "last_processed_key": "",
        "last_processed_last_modified": "2026-07-08T11:00:00Z",
    }
    assert _lab_s3_checkpoint_needs_high_water_reset(current) is False
    assert _lab_s3_checkpoint_is_stale_empty_key(current) is False
