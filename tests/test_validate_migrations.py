"""CLI and pre-upgrade bootstrap behavior for validate_migrations."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.db.migration_integrity import evaluate_migration_integrity
from app.db.validate_migrations import main


def test_pre_upgrade_fresh_empty_database_is_ok(db_engine) -> None:
    from app.config import settings

    with (
        patch("app.db.migration_integrity.alembic_version_table_exists", return_value=False),
        patch("app.db.migration_integrity.public_schema_table_names", return_value=frozenset()),
        patch("app.db.migration_integrity.read_db_revision", return_value=None),
    ):
        report = evaluate_migration_integrity(
            db_engine,
            database_url=settings.DATABASE_URL,
            pre_upgrade=True,
        )
    assert report.status == "ok"
    assert report.ok is True
    assert report.errors == ()
    assert any("Fresh database detected" in i for i in report.infos)
    assert any("initial Alembic bootstrap" in i for i in report.infos)


def test_pre_upgrade_tables_without_alembic_version_errors(db_engine) -> None:
    from app.config import settings

    with (
        patch("app.db.migration_integrity.alembic_version_table_exists", return_value=False),
        patch(
            "app.db.migration_integrity.public_schema_table_names",
            return_value=frozenset({"connectors"}),
        ),
        patch("app.db.migration_integrity.read_db_revision", return_value=None),
    ):
        report = evaluate_migration_integrity(
            db_engine,
            database_url=settings.DATABASE_URL,
            pre_upgrade=True,
        )
    assert report.status == "error"
    assert report.ok is False
    assert any("alembic_version is missing" in e for e in report.errors)


def test_pre_upgrade_partial_schema_with_empty_alembic_row_errors(db_engine) -> None:
    from app.config import settings

    with (
        patch("app.db.migration_integrity.alembic_version_table_exists", return_value=True),
        patch(
            "app.db.migration_integrity.public_schema_table_names",
            return_value=frozenset({"alembic_version", "connectors"}),
        ),
        patch("app.db.migration_integrity.read_db_revision", return_value=None),
    ):
        report = evaluate_migration_integrity(
            db_engine,
            database_url=settings.DATABASE_URL,
            pre_upgrade=True,
        )
    assert report.status == "error"
    assert any("Partially initialized schema" in e for e in report.errors)


def test_without_pre_upgrade_empty_database_errors(db_engine) -> None:
    from app.config import settings

    with (
        patch("app.db.migration_integrity.alembic_version_table_exists", return_value=False),
        patch("app.db.migration_integrity.public_schema_table_names", return_value=frozenset()),
        patch("app.db.migration_integrity.read_db_revision", return_value=None),
    ):
        report = evaluate_migration_integrity(
            db_engine,
            database_url=settings.DATABASE_URL,
            pre_upgrade=False,
        )
    assert report.status == "error"
    assert any("No row in alembic_version" in e for e in report.errors)


@pytest.mark.parametrize(
    ("status", "strict", "expected_exit"),
    [
        ("ok", False, 0),
        ("warn", False, 2),
        ("warn", True, 1),
        ("error", False, 1),
    ],
)
def test_validate_migrations_cli_exit_codes(
    status: str,
    strict: bool,
    expected_exit: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.db.migration_integrity import MigrationIntegrityReport

    report = MigrationIntegrityReport(
        ok=status != "error",
        status=status,  # type: ignore[arg-type]
        repo_heads=("20260513_0019_must_change_pw",),
        db_revision=None,
        db_revision_in_repo=False,
        db_revision_is_head=False,
        db_revision_is_known_orphan=False,
        head_count=1,
        infos=("Fresh database detected (no alembic_version found).",),
    )
    monkeypatch.setattr(
        "app.db.validate_migrations.evaluate_migration_integrity",
        lambda *a, **k: report,
    )
    argv = ["--pre-upgrade"]
    if strict:
        argv.append("--strict")
    assert main(argv) == expected_exit
