"""Startup-time PostgreSQL schema readiness, Alembic visibility, and scheduler gating."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import DBAPIError, OperationalError

from app.config import settings
from app.database import engine
from app.db.migration_integrity import MigrationIntegrityReport, evaluate_migration_integrity

logger = logging.getLogger(__name__)

# Minimum tables for scheduler + API runtime (spec 003-db-model; matches initial Alembic revision).
REQUIRED_TABLES: frozenset[str] = frozenset(
    {
        "connectors",
        "sources",
        "streams",
        "mappings",
        "enrichments",
        "destinations",
        "routes",
        "checkpoints",
        "delivery_logs",
    }
)

@dataclass(frozen=True)
class StartupSnapshot:
    """Structured startup diagnostics (also exposed via /api/v1/runtime/status)."""

    database_dbname: str | None
    database_host: str | None
    database_port: int | None
    database_user: str | None
    database_url_source: str
    alembic_revision: str | None
    schema_ready: bool
    missing_tables: tuple[str, ...]
    scheduler_active: bool
    degraded_reason: str | None
    connection_error: str | None = None
    migration_integrity: MigrationIntegrityReport | None = None

    def as_public_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "database": {
                "dbname": self.database_dbname,
                "host": self.database_host,
                "port": self.database_port,
                "user": self.database_user,
                "url_source": self.database_url_source,
            },
            "alembic_revision": self.alembic_revision,
            "schema_ready": self.schema_ready,
            "missing_tables": list(self.missing_tables),
            "scheduler_active": self.scheduler_active,
            "degraded_reason": self.degraded_reason,
            "connection_error": self.connection_error,
        }
        if self.migration_integrity is not None:
            out["migration_integrity"] = self.migration_integrity.as_dict()
        return out


_snapshot: StartupSnapshot | None = None


def _parse_database_target(url_str: str) -> dict[str, Any]:
    try:
        u = make_url(url_str)
        host = u.host
        if host and host.startswith("/"):
            host = None
        return {
            "dbname": u.database,
            "host": host,
            "port": u.port,
            "user": u.username,
        }
    except Exception:
        return {"dbname": None, "host": None, "port": None, "user": None}


def _database_url_source() -> str:
    """Whether DATABASE_URL came from the process environment or pydantic defaults / .env."""

    return "environment" if os.getenv("DATABASE_URL") is not None else "dotenv_or_default"


def _read_alembic_revision_sync(conn: Any) -> str | None:
    try:
        row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
        if row is None:
            return None
        return str(row[0])
    except DBAPIError:
        # Missing alembic_version leaves PostgreSQL transaction aborted; rollback before inspect().
        conn.rollback()
        return None


def evaluate_schema_with_engine(eng: Engine) -> tuple[bool, tuple[str, ...], str | None, str | None]:
    """Return (schema_ready, missing_tables, alembic_revision, connection_error)."""

    connection_error: str | None = None
    try:
        with eng.connect() as conn:
            rev = _read_alembic_revision_sync(conn)
            insp = inspect(conn)
            present = set(insp.get_table_names())
            missing = sorted(REQUIRED_TABLES - present)
            return (not bool(missing), tuple(missing), rev, None)
    except OperationalError as exc:
        connection_error = str(exc).split("\n")[0][:500]
        return (False, tuple(sorted(REQUIRED_TABLES)), None, connection_error)
    except DBAPIError as exc:
        connection_error = str(exc).split("\n")[0][:500]
        return (False, tuple(sorted(REQUIRED_TABLES)), None, connection_error)


def evaluate_startup_readiness(eng: Engine | None = None) -> StartupSnapshot:
    """Probe DB, log structured diagnostics once, and store snapshot for API/runtime."""

    global _snapshot
    eng = eng or engine
    eff_url = settings.DATABASE_URL
    target = _parse_database_target(eff_url)
    url_src = _database_url_source()

    env_url = os.getenv("DATABASE_URL")
    if env_url is not None and env_url.strip() != eff_url.strip():
        logger.warning(
            "%s",
            {
                "stage": "startup_database_url_inconsistency",
                "message": "DATABASE_URL in environment differs from settings.DATABASE_URL; check pydantic env precedence",
            },
        )

    schema_ready, missing, alembic_rev, conn_err = evaluate_schema_with_engine(eng)

    mig_report: MigrationIntegrityReport | None = None
    if conn_err is None:
        try:
            mig_report = evaluate_migration_integrity(
                eng,
                database_url=eff_url,
                env_database_url=env_url,
                compose_file=os.getenv("GDC_RELEASE_COMPOSE_FILE"),
            )
        except Exception as exc:  # pragma: no cover - defensive
            mig_report = MigrationIntegrityReport(
                ok=False,
                status="error",
                repo_heads=(),
                db_revision=alembic_rev,
                db_revision_in_repo=False,
                db_revision_is_head=False,
                db_revision_is_known_orphan=False,
                head_count=0,
                errors=(f"Migration integrity check failed: {exc}",),
                infos=(),
            )

    scheduler_active = schema_ready and conn_err is None
    degraded: str | None = None
    if conn_err:
        degraded = "database_connection_failed"
    elif not schema_ready:
        degraded = "database_schema_not_ready"
    elif mig_report is not None and mig_report.status == "error":
        degraded = "migration_revision_drift"

    snap = StartupSnapshot(
        database_dbname=target.get("dbname"),
        database_host=target.get("host"),
        database_port=target.get("port"),
        database_user=target.get("user"),
        database_url_source=url_src,
        alembic_revision=alembic_rev,
        schema_ready=schema_ready,
        missing_tables=missing,
        scheduler_active=scheduler_active,
        degraded_reason=degraded,
        connection_error=conn_err,
        migration_integrity=mig_report,
    )
    _snapshot = snap

    log_payload: dict[str, Any] = {
        "stage": "startup_database_diagnostics",
        "database_target_dbname": snap.database_dbname,
        "database_target_host": snap.database_host,
        "database_target_port": snap.database_port,
        "database_url_source": snap.database_url_source,
        "alembic_revision": snap.alembic_revision,
        "schema_ready": snap.schema_ready,
        "missing_tables": list(snap.missing_tables),
        "scheduler_activation": "enabled" if scheduler_active else "disabled",
    }
    if conn_err:
        log_payload["connection_error"] = conn_err
    if mig_report is not None:
        log_payload["migration_integrity_status"] = mig_report.status
        log_payload["migration_integrity_ok"] = mig_report.ok
        if mig_report.errors:
            log_payload["migration_integrity_errors"] = list(mig_report.errors)
        if mig_report.warnings:
            log_payload["migration_integrity_warnings"] = list(mig_report.warnings)
        if mig_report.infos:
            log_payload["migration_integrity_infos"] = list(mig_report.infos)

    if scheduler_active:
        logger.info("%s", log_payload)
    else:
        log_payload["stage"] = "startup_database_not_ready"
        logger.error("%s", log_payload)

    return snap


def build_startup_readiness_summary_payload(
    snap: StartupSnapshot,
    *,
    scheduler_started: bool,
) -> dict[str, Any]:
    """Single structured payload for RC/ops: DB, migrations, scheduler, expected edge topology."""

    db_ready = snap.connection_error is None
    mig_ok = snap.migration_integrity.ok if snap.migration_integrity is not None else bool(snap.alembic_revision)
    migrations_ready = bool(snap.alembic_revision) and snap.schema_ready and mig_ok
    fe_host = (settings.GDC_UPSTREAM_UI_HOST or "").strip()
    proxy_health = (settings.GDC_PROXY_INTERNAL_HEALTH_URL or "").strip()
    return {
        "stage": "startup_readiness_summary",
        "db_ready": db_ready,
        "migrations_ready": migrations_ready,
        "scheduler_started": scheduler_started,
        "frontend_expected": bool(fe_host),
        "reverse_proxy_expected": bool(proxy_health),
        "migration_integrity_status": (
            snap.migration_integrity.status if snap.migration_integrity is not None else None
        ),
    }


def log_startup_readiness_summary(snap: StartupSnapshot, *, scheduler_started: bool) -> None:
    """Emit one INFO line for log aggregation (stage=startup_readiness_summary)."""

    logger.info("%s", build_startup_readiness_summary_payload(snap, scheduler_started=scheduler_started))


def get_startup_snapshot() -> StartupSnapshot:
    """Return last evaluation result, or a safe placeholder before lifespan runs."""

    if _snapshot is None:
        return StartupSnapshot(
            database_dbname=None,
            database_host=None,
            database_port=None,
            database_user=None,
            database_url_source=_database_url_source(),
            alembic_revision=None,
            schema_ready=False,
            missing_tables=tuple(sorted(REQUIRED_TABLES)),
            scheduler_active=False,
            degraded_reason="startup_not_evaluated_yet",
            connection_error=None,
        )
    return _snapshot
