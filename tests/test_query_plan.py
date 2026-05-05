from __future__ import annotations

import os
import subprocess
from pathlib import Path

from sqlalchemy import create_engine, text

PG_URL = "postgresql://gdc:gdc@localhost:5432/gdc"

def _upgrade_head_db() -> str:
    root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["DATABASE_URL"] = PG_URL
    subprocess.run(
        [str(root / "venv/bin/alembic"), "upgrade", "head"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    subprocess.run(
        [str(root / "venv/bin/python"), "-m", "app.db.seed"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return PG_URL


def test_checkpoint_query_uses_index() -> None:
    engine = create_engine(_upgrade_head_db())

    with engine.connect() as conn:
        plan = conn.execute(
            text(
                "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) "
                "SELECT * FROM checkpoints WHERE stream_id = 1"
            )
        ).fetchall()

    plan_str = str(plan)
    assert "uq_checkpoints_stream_id" in plan_str


def test_delivery_logs_query_uses_index() -> None:
    engine = create_engine(_upgrade_head_db())

    with engine.connect() as conn:
        plan = conn.execute(
            text(
                "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) "
                "SELECT * FROM delivery_logs WHERE stream_id = 1 ORDER BY created_at DESC"
            )
        ).fetchall()

    plan_str = str(plan)
    assert "idx_logs_stream_id_created_at" in plan_str
