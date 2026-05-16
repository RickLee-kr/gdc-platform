from __future__ import annotations

import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
from sqlalchemy.orm import Session

from tests.db_test_policy import ALLOWED_PYTEST_DATABASE_CATALOGS as ALLOWED_TEST_DB_NAMES


def _validate_safe_test_db_url(test_db_url: str) -> str:
    parsed = urlparse(test_db_url)
    db_name = parsed.path.strip("/").split("/")[-1] if parsed.path.strip("/") else ""
    if db_name not in ALLOWED_TEST_DB_NAMES:
        pytest.skip(
            "Refusing to run query profile test on non-test database. "
            f"Use TEST_DATABASE_URL with one of {sorted(ALLOWED_TEST_DB_NAMES)}; "
            f"current database name: {db_name!r}"
        )
    return test_db_url


def test_profile_query_plan_script_outputs_sections(
    migrated_db_session: Session, test_db_url: str
) -> None:
    del migrated_db_session
    root = Path(__file__).resolve().parents[1]
    db_url = _validate_safe_test_db_url(test_db_url)

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
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


def test_profile_query_plan_script_rejects_non_postgres_url(test_db_url: str) -> None:
    root = Path(__file__).resolve().parents[1]
    db_url = _validate_safe_test_db_url(test_db_url)

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url.replace("postgresql://", "mysql://", 1)
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
