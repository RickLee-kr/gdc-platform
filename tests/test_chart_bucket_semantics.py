"""Chart bucket metadata semantics."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
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

