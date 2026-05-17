"""Runtime aggregate snapshot materialization validation."""

from __future__ import annotations

from datetime import datetime, timezone
from datetime import timedelta

from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.main import app
from app.runtime.models import RuntimeAggregateSnapshot
from app.runtime.snapshot_materialization import cleanup_expired_snapshots, get_or_materialize_snapshot

UTC = timezone.utc


class _SnapshotPayload(BaseModel):
    snapshot_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime
    metric_meta: dict = {}
    visualization_meta: dict = {}


def test_dashboard_snapshot_materialization_reuses_same_snapshot_metadata(db_session: Session) -> None:
    db_session.execute(text("SELECT 1"))
    snapshot_id = datetime(2026, 5, 17, 11, 0, tzinfo=UTC).isoformat()
    client = TestClient(app)

    first = client.get(
        "/api/v1/runtime/dashboard/outcome-timeseries",
        params={"window": "1h", "snapshot_id": snapshot_id},
    )
    second = client.get(
        "/api/v1/runtime/dashboard/outcome-timeseries",
        params={"window": "1h", "snapshot_id": snapshot_id},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["snapshot_id"] == snapshot_id
    assert second.json()["snapshot_id"] == snapshot_id
    assert first.json()["window_start"] == second.json()["window_start"]
    assert first.json()["window_end"] == second.json()["window_end"]


def test_snapshot_materialization_persists_ontology_metadata(db_engine) -> None:
    snapshot_id = datetime(2026, 5, 17, 12, 0, tzinfo=UTC).isoformat()
    client = TestClient(app)
    response = client.get(
        "/api/v1/runtime/dashboard/summary",
        params={"window": "1h", "snapshot_id": snapshot_id},
    )
    assert response.status_code == 200

    with db_engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT payload_json, metric_meta_json, visualization_meta_json
                FROM runtime_aggregate_snapshots
                WHERE snapshot_scope = 'dashboard_summary'
                  AND snapshot_id = :snapshot_id
                ORDER BY id DESC
                LIMIT 1
                """
            ),
            {"snapshot_id": snapshot_id},
        ).first()

    assert row is not None
    assert row[0]["snapshot_id"] == snapshot_id
    assert "processed_events.window" in row[1]
    assert "runtime.throughput.window_avg_eps" in row[2]


def test_snapshot_materialization_cleans_expired_rows(db_session: Session) -> None:
    now = datetime(2026, 5, 17, 13, 0, tzinfo=UTC)
    db_session.add(
        RuntimeAggregateSnapshot(
            snapshot_scope="expired",
            snapshot_key="old",
            snapshot_id="old",
            generated_at=now - timedelta(minutes=5),
            window_start=now - timedelta(hours=1),
            window_end=now - timedelta(minutes=5),
            payload_json={"snapshot_id": "old"},
            metric_meta_json={},
            visualization_meta_json={},
            expires_at=now - timedelta(seconds=1),
        )
    )
    db_session.commit()

    deleted = cleanup_expired_snapshots(db_session, now=now)
    db_session.commit()

    assert deleted == 1
    assert db_session.query(RuntimeAggregateSnapshot).filter_by(snapshot_id="old").first() is None


def test_snapshot_materialization_reuses_cached_backend_snapshot(db_session: Session) -> None:
    now = datetime(2026, 5, 17, 14, 0, tzinfo=UTC)
    calls = 0

    def _builder() -> _SnapshotPayload:
        nonlocal calls
        calls += 1
        return _SnapshotPayload(
            snapshot_id=now.isoformat(),
            generated_at=now,
            window_start=now - timedelta(hours=1),
            window_end=now,
            metric_meta={"processed_events.window": {}},
            visualization_meta={"dashboard.delivery_outcomes.bucket_count": {}},
        )

    first = get_or_materialize_snapshot(
        db_session,
        scope="unit",
        key="window=1h",
        snapshot_id=now.isoformat(),
        model_type=_SnapshotPayload,
        builder=_builder,
    )
    second = get_or_materialize_snapshot(
        db_session,
        scope="unit",
        key="window=1h",
        snapshot_id=now.isoformat(),
        model_type=_SnapshotPayload,
        builder=_builder,
    )

    assert first.snapshot_id == second.snapshot_id == now.isoformat()
    assert calls == 1


def test_snapshot_materialization_default_ttl_uses_runtime_config(db_session: Session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "GDC_RUNTIME_AGGREGATE_SNAPSHOT_TTL_SECONDS", 3)
    now = datetime(2026, 5, 17, 15, 0, tzinfo=UTC)
    before = datetime.now(UTC)

    def _builder() -> _SnapshotPayload:
        return _SnapshotPayload(
            snapshot_id=now.isoformat(),
            generated_at=now,
            window_start=now - timedelta(hours=1),
            window_end=now,
        )

    get_or_materialize_snapshot(
        db_session,
        scope="unit-config",
        key="window=1h",
        snapshot_id=now.isoformat(),
        model_type=_SnapshotPayload,
        builder=_builder,
    )
    after = datetime.now(UTC)

    expires_at = db_session.execute(
        text(
            """
            SELECT expires_at
            FROM runtime_aggregate_snapshots
            WHERE snapshot_scope = 'unit-config'
            ORDER BY id DESC
            LIMIT 1
            """
        )
    ).scalar_one()
    assert before + timedelta(seconds=3) <= expires_at <= after + timedelta(seconds=4)

