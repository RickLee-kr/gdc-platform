"""CLI: validate Alembic repo/DB consistency (dedicated exit codes for install/upgrade)."""

from __future__ import annotations

import argparse
import json
import os
import sys

from app.config import settings
from app.database import engine
from app.db.migration_integrity import (
    MigrationIntegrityReport,
    evaluate_migration_integrity,
    load_script_directory,
    project_root,
)

# Keep in sync with scripts/release/_release_migration_validate.sh
EXIT_OK = 0
EXIT_FRESH_BOOTSTRAP = 2
EXIT_WARN = 3
EXIT_ERROR = 11

FRESH_DATABASE_INFO_MARK = "Fresh database detected"


def is_fresh_bootstrap_report(report: MigrationIntegrityReport) -> bool:
    return any(FRESH_DATABASE_INFO_MARK in info for info in report.infos)


def resolve_exit_code(report: MigrationIntegrityReport, *, strict: bool) -> int:
    """Map integrity report to a process exit code for install/upgrade orchestration."""

    if report.status == "error":
        return EXIT_ERROR
    if is_fresh_bootstrap_report(report):
        return EXIT_FRESH_BOOTSTRAP
    if report.status == "warn":
        return EXIT_ERROR if strict else EXIT_WARN
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Validate Alembic revision graph vs live alembic_version (read-only)."
    )
    p.add_argument(
        "--pre-upgrade",
        action="store_true",
        help="Allow DB revision behind head (warn); still fail on orphan/unknown revisions.",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as failure (exit 11 instead of 3).",
    )
    p.add_argument("--json", action="store_true", help="Emit JSON report on stdout.")
    p.add_argument(
        "--print-alembic-heads",
        action="store_true",
        help="Print repository head revision IDs from the local script directory.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.print_alembic_heads:
        heads = load_script_directory(project_root()).get_heads()
        for h in heads:
            print(h)
        return EXIT_OK

    report = evaluate_migration_integrity(
        engine,
        database_url=settings.DATABASE_URL,
        env_database_url=os.environ.get("DATABASE_URL"),
        pre_upgrade=bool(args.pre_upgrade),
        compose_file=os.environ.get("GDC_RELEASE_COMPOSE_FILE"),
    )

    payload = report.as_dict()
    payload["database_url_source"] = (
        "environment" if os.environ.get("DATABASE_URL") else "dotenv_or_default"
    )
    payload["exit_code"] = resolve_exit_code(report, strict=bool(args.strict))

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("=== GDC migration integrity ===")
        print(f"status: {report.status}")
        print(f"database: {report.database_target.get('dbname')!r} @ "
              f"{report.database_target.get('host')!r}:{report.database_target.get('port')!r}")
        print(f"repo_heads: {', '.join(report.repo_heads) or '(none)'}")
        print(f"db_revision: {report.db_revision!r}")
        for w in report.warnings:
            print(f"WARN: {w}")
        for i in report.infos:
            print(f"INFO: {i}")
        for e in report.errors:
            print(f"ERROR: {e}")

    return resolve_exit_code(report, strict=bool(args.strict))


if __name__ == "__main__":
    sys.exit(main())
