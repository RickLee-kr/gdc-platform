"""Partition maintenance and observability tests."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.db.partition_maintenance import (
    build_partition_observability,
    delivery_logs_is_partitioned,
    run_partition_maintenance,
)
from app.db.partition_maintenance_scheduler import PartitionMaintenanceScheduler
from app.main import app
from app.platform_admin.repository import get_retention_policy_row

UTC = timezone.utc


def test_delivery_logs_partitioned_flag(db_session: Session) -> None:
    assert delivery_logs_is_partitioned(db_session) is True


def test_run_partition_maintenance_is_idempotent(db_session: Session) -> None:
    first = run_partition_maintenance(db_session, months_ahead=1)
    assert first.status in {"ok", "warn"}
    assert first.ensured_partitions
    second = run_partition_maintenance(db_session, months_ahead=1)
    assert second.status in {"ok", "warn"}


def test_partition_observability_snapshot(db_session: Session) -> None:
    row = get_retention_policy_row(db_session)
    pol_row_days = int(row.logs_retention_days)
    snap = build_partition_observability(
        db_session,
        retention_days=pol_row_days,
        checkpoint_history_retention_days=pol_row_days,
    )
    assert snap.delivery_logs_partitioned
    assert snap.partition_key == "RANGE (created_at)"
    assert snap.partitions


def test_partition_maintenance_scheduler_trigger_once(db_session: Session) -> None:
    sched = PartitionMaintenanceScheduler(tick_seconds=3600.0)
    out = sched.trigger_once()
    assert out is not None
    assert out.status in {"ok", "warn", "skipped", "error"}
    sched.stop()


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override() -> Session:
        yield db_session

    app.dependency_overrides[get_db] = _override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_retention_partitions_http(client: TestClient) -> None:
    r = client.get("/api/v1/retention/partitions")
    assert r.status_code == 200
    body = r.json()
    assert body["delivery_logs_partitioned"] is True
    assert "partitions" in body
    assert body["retention_days"] >= 1


def test_retention_env_overrides_delivery_and_checkpoint(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.retention.config import effective_retention_policies

    monkeypatch.setattr(settings, "GDC_DELIVERY_LOG_RETENTION_DAYS", 45)
    monkeypatch.setattr(settings, "GDC_CHECKPOINT_HISTORY_RETENTION_DAYS", 120)
    row = get_retention_policy_row(db_session)
    pol = effective_retention_policies(row)
    assert pol["delivery_logs_days"] == 45
    assert pol["checkpoint_history_days"] == 120
