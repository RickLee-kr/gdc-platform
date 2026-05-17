"""PostgreSQL delivery_logs monthly partitioning validation."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.delivery_log_partitions import calculate_delivery_log_partition_drop_targets, ensure_delivery_log_partitions
from app.logs.models import DeliveryLog

UTC = timezone.utc


def test_delivery_logs_is_range_partitioned_by_created_at(db_engine: Engine, db_session: Session) -> None:
    db_session.execute(text("SELECT 1"))
    with db_engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_partkeydef(c.oid)
                FROM pg_class c
                JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
                WHERE c.relname = 'delivery_logs'
                """
            )
        ).scalar()

    assert row == "RANGE (created_at)"


def test_delivery_logs_monthly_partition_pruning_explain_analyze(db_session: Session) -> None:
    db_session.add(
        DeliveryLog(
            stage="run_complete",
            level="INFO",
            status="OK",
            message="partition pruning validation",
            payload_sample={"input_events": 1},
            retry_count=0,
            created_at=datetime(2026, 5, 17, 1, 2, 3, tzinfo=UTC),
        )
    )
    db_session.commit()

    rows = db_session.execute(
        text(
            """
            EXPLAIN ANALYZE
            SELECT count(*)
            FROM delivery_logs
            WHERE created_at >= '2026-05-01 00:00:00+00'
              AND created_at < '2026-06-01 00:00:00+00'
            """
        )
    ).fetchall()
    plan = "\n".join(str(r[0]) for r in rows)

    assert "delivery_logs_2026_05" in plan
    assert "delivery_logs_2026_06" not in plan


def test_future_partition_ensure_is_additive(db_session: Session) -> None:
    names = ensure_delivery_log_partitions(
        db_session,
        start_month=datetime(2026, 7, 1, tzinfo=UTC),
        months_ahead=1,
    )
    db_session.commit()

    assert names == ["delivery_logs_2026_07", "delivery_logs_2026_08", "delivery_logs_default"]
    existing = {
        str(r[0])
        for r in db_session.execute(
            text(
                """
                SELECT child.relname
                FROM pg_inherits
                JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
                JOIN pg_class child ON child.oid = pg_inherits.inhrelid
                WHERE parent.relname = 'delivery_logs'
                """
            )
        )
    }
    assert {"delivery_logs_2026_07", "delivery_logs_2026_08"}.issubset(existing)


def test_partition_drop_targets_exclude_current_and_next_month(db_session: Session) -> None:
    ensure_delivery_log_partitions(
        db_session,
        start_month=datetime(2026, 1, 1, tzinfo=UTC),
        months_ahead=5,
    )
    db_session.commit()

    targets = calculate_delivery_log_partition_drop_targets(
        db_session,
        retention_days=60,
        now=datetime(2026, 5, 17, tzinfo=UTC),
    )
    names = {target.partition_name for target in targets}

    assert "delivery_logs_2026_01" in names
    assert "delivery_logs_2026_05" not in names
    assert "delivery_logs_2026_06" not in names

