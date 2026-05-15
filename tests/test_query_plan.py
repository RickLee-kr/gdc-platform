from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.seed import seed_dev_data
from app.logs.models import DeliveryLog


def test_checkpoint_query_uses_index(migrated_db_session: Session, db_engine: Engine) -> None:
    seed_dev_data(migrated_db_session)
    with db_engine.connect() as conn:
        plan = conn.execute(
            text(
                "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) "
                "SELECT * FROM checkpoints WHERE stream_id = 1"
            )
        ).fetchall()

    plan_str = str(plan)
    assert "uq_checkpoints_stream_id" in plan_str


def test_delivery_logs_query_uses_index(migrated_db_session: Session, db_engine: Engine) -> None:
    """Planner must be able to use idx_logs_stream_id_created_at for stream + ORDER BY created_at.

    With few or zero rows PostgreSQL often picks Seq Scan; seed volume + ANALYZE and a
    transaction-local seqscan disable make EXPLAIN deterministic while still exercising
    the real index definition.
    """

    ids = seed_dev_data(migrated_db_session)
    sid = int(ids["stream_id"])
    base = datetime.now(timezone.utc) - timedelta(days=2)
    rows = [
        {
            "connector_id": ids["connector_id"],
            "stream_id": sid,
            "route_id": ids["route_id"],
            "destination_id": ids["destination_id"],
            "stage": "route_send_success",
            "level": "INFO",
            "status": "OK",
            "message": "plan-test",
            "payload_sample": {},
            "retry_count": 0,
            "http_status": None,
            "latency_ms": None,
            "error_code": None,
            "created_at": base + timedelta(microseconds=i),
        }
        for i in range(4000)
    ]
    migrated_db_session.bulk_insert_mappings(DeliveryLog, rows)
    migrated_db_session.commit()

    with db_engine.connect() as conn:
        conn.execute(text("ANALYZE delivery_logs"))
        conn.commit()

    explain = text(
        "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) "
        "SELECT * FROM delivery_logs WHERE stream_id = :sid ORDER BY created_at DESC"
    )
    with db_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("SET LOCAL enable_seqscan = OFF"))
            plan = conn.execute(explain, {"sid": sid}).fetchall()

    plan_str = str(plan)
    assert "idx_logs_stream_id_created_at" in plan_str
