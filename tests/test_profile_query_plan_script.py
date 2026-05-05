from __future__ import annotations

import os
import subprocess
from pathlib import Path

PG_URL = "postgresql://gdc:gdc@localhost:5432/gdc"


def _prepare_postgres(root: Path) -> None:
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


def test_profile_query_plan_script_outputs_sections() -> None:
    root = Path(__file__).resolve().parents[1]
    _prepare_postgres(root)

    env = os.environ.copy()
    env["DATABASE_URL"] = PG_URL
    completed = subprocess.run(
        [
            str(root / "venv/bin/python"),
            str(root / "scripts/profile_query_plan.py"),
            "--stream-id",
            "1",
            "--limit",
            "10",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    stdout = completed.stdout
    assert "DB DIALECT" in stdout
    assert "CHECKPOINT QUERY PLAN" in stdout
    assert "ROUTES QUERY PLAN" in stdout
    assert "DELIVERY_LOGS BY STREAM QUERY PLAN" in stdout
    assert "DELIVERY_LOGS BY ROUTE QUERY PLAN" in stdout
    assert "DELIVERY_LOGS BY DESTINATION QUERY PLAN" in stdout
    assert "RECOMMENDATION" in stdout


def test_profile_query_plan_script_fails_on_non_postgres_url() -> None:
    root = Path(__file__).resolve().parents[1]

    env = os.environ.copy()
    env["DATABASE_URL"] = "sqlite" + ":///app.db"
    completed = subprocess.run(
        [
            str(root / "venv/bin/python"),
            str(root / "scripts/profile_query_plan.py"),
        ],
        capture_output=True,
        text=True,
        env=env,
    )

    assert completed.returncode == 1
    assert "PostgreSQL DATABASE_URL is required" in completed.stderr
