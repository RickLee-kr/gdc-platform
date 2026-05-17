"""Chart bucket metadata semantics."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.logs.aggregates import PlatformOutcomeBucketRow, dense_platform_outcome_buckets
from app.main import app


def test_dashboard_outcome_timeseries_exposes_fixed_bucket_contract(db_session: Session) -> None:
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        body = client.get(
            "/api/v1/runtime/dashboard/outcome-timeseries",
            params={"window": "1h", "snapshot_id": "2026-01-01T01:00:00+00:00"},
        ).json()
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert body["bucket_size_seconds"] == 150
    assert body["bucket_count"] == 24
    assert body["bucket_alignment"] == "window_floor_epoch"
    assert body["bucket_timezone"] == "UTC"
    assert body["bucket_mode"] == "fixed_window"
    assert len(body["buckets"]) == body["bucket_count"]

    meta = body["visualization_meta"]["dashboard.delivery_outcomes.bucket_count"]
    assert meta["normalization_rule"] == "raw_count"
    assert meta["cumulative_semantics"] == "not_cumulative"
    assert meta["bucket_size_seconds"] == 150
    assert meta["bucket_count"] == 24


def test_dense_platform_outcome_buckets_keeps_current_partial_bucket() -> None:
    end_at = datetime(2026, 1, 1, 1, 1, 10, tzinfo=UTC)
    bucket_seconds = 150
    current_bucket = datetime(2026, 1, 1, 1, 0, 0, tzinfo=UTC)
    sparse = [
        PlatformOutcomeBucketRow(
            bucket_start=current_bucket,
            success=7,
            failed=0,
            rate_limited=0,
        )
    ]

    buckets = dense_platform_outcome_buckets(
        sparse,
        start_at=end_at - timedelta(hours=1),
        end_at=end_at,
        bucket_seconds=bucket_seconds,
        max_buckets=24,
    )

    assert len(buckets) == 24
    assert buckets[-1].bucket_start == current_bucket
    assert buckets[-1].success == 7

