"""Alembic revision graph consistency checks (read-only; never applies migrations)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.script.revision import ResolutionError
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url

from app.config import settings

# Revisions reported in the field but not present in this repository's alembic/versions/.
KNOWN_ORPHAN_REVISIONS: frozenset[str] = frozenset({"20260513_0021_dl_parts"})
_EMBEDDED_PASSWORD_WARNING_MARK = "embeds a password"

Status = Literal["ok", "warn", "error"]


def _is_dev_app_env() -> bool:
    return (getattr(settings, "APP_ENV", "") or "").strip().lower() in {"development", "dev", "local"}


def _partition_embedded_password_hints(warnings: list[str]) -> tuple[list[str], list[str]]:
    """In development, password-in-URL hints are informational and do not raise migration status to warn."""

    if not _is_dev_app_env():
        return warnings, []
    kept: list[str] = []
    infos: list[str] = []
    for w in warnings:
        if _EMBEDDED_PASSWORD_WARNING_MARK in w:
            infos.append(w)
        else:
            kept.append(w)
    return kept, infos


@dataclass(frozen=True)
class MigrationIntegrityReport:
    """Outcome of comparing repo Alembic scripts to the live ``alembic_version`` row."""

    ok: bool
    status: Status
    repo_heads: tuple[str, ...]
    db_revision: str | None
    db_revision_in_repo: bool
    db_revision_is_head: bool
    db_revision_is_known_orphan: bool
    head_count: int
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    infos: tuple[str, ...] = ()
    database_target: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "status": self.status,
            "repo_heads": list(self.repo_heads),
            "db_revision": self.db_revision,
            "db_revision_in_repo": self.db_revision_in_repo,
            "db_revision_is_head": self.db_revision_is_head,
            "db_revision_is_known_orphan": self.db_revision_is_known_orphan,
            "head_count": self.head_count,
            "errors": list(self.errors),
            "warnings": list(self.warnings),
            "infos": list(self.infos),
            "database_target": dict(self.database_target),
        }


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_script_directory(root: Path | None = None) -> ScriptDirectory:
    root = root or project_root()
    ini = root / "alembic.ini"
    if not ini.is_file():
        raise FileNotFoundError(f"alembic.ini not found under {root}")
    cfg = Config(str(ini))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return ScriptDirectory.from_config(cfg)


def alembic_version_table_exists(engine: Engine) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'alembic_version' LIMIT 1"
            )
        ).first()
        return row is not None


def public_schema_table_names(engine: Engine) -> frozenset[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )
        ).fetchall()
    return frozenset(str(r[0]) for r in rows)


def read_db_revision(engine: Engine) -> str | None:
    if not alembic_version_table_exists(engine):
        return None
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
        if row is None:
            return None
        return str(row[0])


def parse_database_target(url: str) -> dict[str, Any]:
    try:
        u = make_url(url)
        host = u.host
        if host and str(host).startswith("/"):
            host = None
        return {
            "scheme": u.drivername,
            "dbname": u.database,
            "host": host,
            "port": u.port,
            "user": u.username,
        }
    except Exception:
        return {"scheme": None, "dbname": None, "host": None, "port": None, "user": None}


def audit_database_url(
    url: str,
    *,
    env_url: str | None = None,
    compose_file: str | None = None,
) -> list[str]:
    """Return human-readable warnings for common DATABASE_URL mis-targeting."""

    warnings: list[str] = []
    target = parse_database_target(url)
    scheme = (target.get("scheme") or "").lower()
    dbname = target.get("dbname")
    host = (target.get("host") or "").lower()
    port = target.get("port")

    if scheme and not scheme.startswith("postgres"):
        warnings.append(
            f"DATABASE_URL scheme {scheme!r} is not PostgreSQL (SQLite and other engines are unsupported)."
        )

    if env_url is not None and env_url.strip() and env_url.strip() != url.strip():
        warnings.append(
            "Process env DATABASE_URL differs from settings.DATABASE_URL; host tools may target a different "
            "catalog than the API container."
        )

    compose = (compose_file or os.getenv("GDC_RELEASE_COMPOSE_FILE") or "").strip()
    if compose.endswith("docker-compose.platform.yml") and dbname and dbname != "datarelay":
        warnings.append(
            f"Compose file {compose!r} expects catalog datarelay; DATABASE_URL database is {dbname!r}."
        )
    if "docker-compose.https.yml" in compose and dbname and dbname != "gdc":
        warnings.append(
            f"Compose file {compose!r} expects catalog gdc; DATABASE_URL database is {dbname!r}."
        )

    if dbname == "datarelay" and port not in (None, 55432) and host in ("127.0.0.1", "localhost", "::1"):
        warnings.append(
            f"Lab catalog datarelay on loopback usually uses port 55432 (got {port!r})."
        )
    if dbname == "gdc" and port == 55432 and host in ("127.0.0.1", "localhost", "::1"):
        warnings.append(
            "Catalog gdc on port 55432 is unusual; platform compose uses datarelay on that port."
        )

    try:
        p = urlparse(url)
        if p.password:
            warnings.append(
                "DATABASE_URL embeds a password; prefer env injection and never commit credentials."
            )
    except Exception:
        pass

    return warnings


def _revision_in_script_tree(script: ScriptDirectory, revision: str) -> bool:
    try:
        script.get_revision(revision)
        return True
    except ResolutionError:
        return False


def evaluate_migration_integrity(
    engine: Engine,
    *,
    database_url: str,
    env_database_url: str | None = None,
    root: Path | None = None,
    pre_upgrade: bool = False,
    compose_file: str | None = None,
) -> MigrationIntegrityReport:
    """Compare Alembic scripts in the repo to the database ``alembic_version`` stamp."""

    errors: list[str] = []
    warnings: list[str] = []
    root = root or project_root()
    target = parse_database_target(database_url)

    warnings.extend(
        audit_database_url(
            database_url,
            env_url=env_database_url,
            compose_file=compose_file,
        )
    )
    warnings, infos_list = _partition_embedded_password_hints(warnings)

    try:
        script = load_script_directory(root)
        repo_heads = tuple(script.get_heads())
    except Exception as exc:
        return MigrationIntegrityReport(
            ok=False,
            status="error",
            repo_heads=(),
            db_revision=None,
            db_revision_in_repo=False,
            db_revision_is_head=False,
            db_revision_is_known_orphan=False,
            head_count=0,
            errors=(f"Cannot load Alembic scripts: {exc}",),
            warnings=tuple(warnings),
            infos=tuple(infos_list),
            database_target=target,
        )

    head_count = len(repo_heads)
    if head_count == 0:
        errors.append("Alembic script directory has no head revision.")
    elif head_count > 1:
        errors.append(f"Multiple Alembic heads in repository: {', '.join(repo_heads)}.")

    db_rev: str | None
    alembic_table_exists = False
    public_tables: frozenset[str] = frozenset()
    try:
        alembic_table_exists = alembic_version_table_exists(engine)
        public_tables = public_schema_table_names(engine)
        db_rev = read_db_revision(engine)
    except Exception as exc:
        errors.append(f"Cannot read alembic_version: {exc}")
        db_rev = None

    in_repo = False
    is_head = False
    is_orphan = False

    if db_rev is None:
        non_alembic_tables = public_tables - {"alembic_version"}
        if pre_upgrade and not non_alembic_tables:
            infos_list.append("Fresh database detected (no alembic_version found).")
            infos_list.append("Proceeding with initial Alembic bootstrap.")
        elif non_alembic_tables and not alembic_table_exists:
            errors.append(
                "Application tables exist but alembic_version is missing — "
                "partial schema initialization; see docs/operations/migration-recovery-runbook.md."
            )
        elif non_alembic_tables:
            errors.append(
                "Partially initialized schema: application tables exist but alembic_version "
                "has no revision row; manual recovery required."
            )
        else:
            errors.append("No row in alembic_version — run Alembic upgrade before starting traffic.")
    else:
        if db_rev in KNOWN_ORPHAN_REVISIONS:
            is_orphan = True
            errors.append(
                f"Database revision {db_rev!r} is a known orphan (not shipped in this repository). "
                "See docs/operations/migration-recovery-runbook.md."
            )
        elif not _revision_in_script_tree(script, db_rev):
            is_orphan = True
            errors.append(
                f"Database revision {db_rev!r} is not present in the repository Alembic graph "
                "(orphan / non-committed migration)."
            )
        else:
            in_repo = True
            is_head = db_rev in repo_heads
            if not is_head and repo_heads:
                msg = (
                    f"Database revision {db_rev!r} is behind repository head "
                    f"{repo_heads[0]!r}; run alembic upgrade head."
                )
                if pre_upgrade:
                    warnings.append(msg)
                else:
                    errors.append(msg)

    status: Status = "error" if errors else ("warn" if warnings else "ok")
    ok = status != "error"
    return MigrationIntegrityReport(
        ok=ok,
        status=status,
        repo_heads=repo_heads,
        db_revision=db_rev,
        db_revision_in_repo=in_repo,
        db_revision_is_head=is_head,
        db_revision_is_known_orphan=is_orphan,
        head_count=head_count,
        errors=tuple(errors),
        warnings=tuple(warnings),
        infos=tuple(infos_list),
        database_target=target,
    )


__all__ = [
    "KNOWN_ORPHAN_REVISIONS",
    "MigrationIntegrityReport",
    "alembic_version_table_exists",
    "audit_database_url",
    "evaluate_migration_integrity",
    "load_script_directory",
    "parse_database_target",
    "project_root",
    "public_schema_table_names",
    "read_db_revision",
]
