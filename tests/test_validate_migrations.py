"""CLI exit codes and install pre-migration validate flow."""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from app.db.migration_integrity import evaluate_migration_integrity
from app.db.validate_migrations import (
    EXIT_ERROR,
    EXIT_FRESH_BOOTSTRAP,
    EXIT_OK,
    EXIT_WARN,
    is_fresh_bootstrap_report,
    main,
    resolve_exit_code,
)
from app.db.migration_integrity import MigrationIntegrityReport

ROOT = Path(__file__).resolve().parents[1]
MIG_VALIDATE_SH = ROOT / "scripts" / "release" / "_release_migration_validate.sh"


def _fresh_bootstrap_report(*, status: str = "ok", warnings: tuple[str, ...] = ()) -> MigrationIntegrityReport:
    return MigrationIntegrityReport(
        ok=status != "error",
        status=status,  # type: ignore[arg-type]
        repo_heads=("20260513_0019_must_change_pw",),
        db_revision=None,
        db_revision_in_repo=False,
        db_revision_is_head=False,
        db_revision_is_known_orphan=False,
        head_count=1,
        warnings=warnings,
        infos=(
            "Fresh database detected (no alembic_version found).",
            "Proceeding with initial Alembic bootstrap.",
        ),
    )


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
    assert is_fresh_bootstrap_report(report)
    assert resolve_exit_code(report, strict=False) == EXIT_FRESH_BOOTSTRAP


def test_fresh_bootstrap_with_url_warnings_returns_exit_fresh_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = _fresh_bootstrap_report(
        status="warn",
        warnings=("DATABASE_URL embeds a password; prefer env injection.",),
    )
    monkeypatch.setattr(
        "app.db.validate_migrations.evaluate_migration_integrity",
        lambda *a, **k: report,
    )
    assert main(["--pre-upgrade"]) == EXIT_FRESH_BOOTSTRAP


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
    assert resolve_exit_code(report, strict=False) == EXIT_ERROR


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
    assert resolve_exit_code(report, strict=False) == EXIT_ERROR


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
    assert resolve_exit_code(report, strict=False) == EXIT_ERROR


@pytest.mark.parametrize(
    ("status", "strict", "expected_exit"),
    [
        ("ok", False, EXIT_OK),
        ("warn", False, EXIT_WARN),
        ("warn", True, EXIT_ERROR),
        ("error", False, EXIT_ERROR),
    ],
)
def test_validate_migrations_cli_exit_codes_non_bootstrap(
    status: str,
    strict: bool,
    expected_exit: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = MigrationIntegrityReport(
        ok=status != "error",
        status=status,  # type: ignore[arg-type]
        repo_heads=("20260513_0019_must_change_pw",),
        db_revision="20260512_0018_op_ret_meta",
        db_revision_in_repo=True,
        db_revision_is_head=False,
        db_revision_is_known_orphan=False,
        head_count=1,
        warnings=("Database revision is behind repository head.",) if status == "warn" else (),
    )
    monkeypatch.setattr(
        "app.db.validate_migrations.evaluate_migration_integrity",
        lambda *a, **k: report,
    )
    argv = ["--pre-upgrade"]
    if strict:
        argv.append("--strict")
    assert main(argv) == expected_exit


@pytest.mark.parametrize(
    ("rc", "expect_success", "expect_fresh_info"),
    [
        (EXIT_OK, True, False),
        (EXIT_FRESH_BOOTSTRAP, True, True),
        (EXIT_WARN, True, False),
        (EXIT_ERROR, False, False),
        (1, False, False),
    ],
)
def test_install_pre_migration_validate_flow(
    rc: int,
    expect_success: bool,
    expect_fresh_info: bool,
) -> None:
    proc = subprocess.run(
        [
            "bash",
            "-c",
            f'source "{MIG_VALIDATE_SH}"; gdc_release_handle_pre_migration_validate_rc {rc}',
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if expect_success:
        assert proc.returncode == 0, proc.stderr
    else:
        assert proc.returncode != 0
    if expect_fresh_info:
        assert "Fresh database bootstrap state detected" in proc.stdout
        assert "Proceeding with initial Alembic upgrade" in proc.stdout
    else:
        assert "Fresh database bootstrap state detected" not in proc.stdout
