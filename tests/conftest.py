from __future__ import annotations

import os

# RBAC-lite (spec 020): most integration tests call the API without a bearer token
# and rely on the anonymous ADMINISTRATOR fallback when REQUIRE_AUTH is false.
# A developer/CI shell or `.env` setting REQUIRE_AUTH=true would otherwise 401 the
# entire suite. Tests that need an authenticated gate use monkeypatch on
# ``app.config.settings`` (see tests/test_jwt_session_auth.py).
os.environ["REQUIRE_AUTH"] = "false"

import threading
from pathlib import Path
from urllib.parse import urlparse

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.checkpoints import models as _checkpoint_models  # noqa: F401
from app.connectors import models as _connector_models  # noqa: F401
from app.destinations import models as _dest_models  # noqa: F401
from app.enrichments import models as _enrich_models  # noqa: F401
from app.logs import models as _log_models  # noqa: F401
from app.mappings import models as _map_models  # noqa: F401
from app.routes import models as _route_models  # noqa: F401
from app.sources import models as _source_models  # noqa: F401
from app.streams import models as _stream_models  # noqa: F401
from app.validation import models as _validation_models  # noqa: F401
from app.backfill import models as _backfill_models  # noqa: F401
from app.platform_admin import models as _platform_admin_models  # noqa: F401

pytest_plugins = ("tests.e2e_syslog_helpers",)

# Isolated test stack default (docker-compose.test.yml postgres-test host publish 55432).
_DEFAULT_TEST_DB_URL = "postgresql://gdc:gdc@127.0.0.1:55432/gdc_test"
_ALLOWED_TEST_DB_NAMES = frozenset({"gdc_test", "gdc_e2e_test"})

_schema_ddl_lock = threading.Lock()


def _database_name_from_url(url: str) -> str:
    path = urlparse(url).path.strip("/")
    return path.split("/")[-1] if path else ""


def _resolve_test_database_url() -> str:
    """Prefer TEST_DATABASE_URL, then DATABASE_URL, then local compose default."""

    return os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL") or _DEFAULT_TEST_DB_URL


def _validate_test_database_url(url: str) -> None:
    name = _database_name_from_url(url)
    if name not in _ALLOWED_TEST_DB_NAMES:
        raise RuntimeError(
            "Refusing pytest run: database name must be one of "
            f"{sorted(_ALLOWED_TEST_DB_NAMES)} (got {name!r} from URL host/path). "
            "Set TEST_DATABASE_URL to an isolated PostgreSQL test database "
            f"(recommended: {_DEFAULT_TEST_DB_URL!r})."
        )


def pytest_configure() -> None:
    """Pin the whole test process to the explicit PostgreSQL test database."""

    url = _resolve_test_database_url()
    _validate_test_database_url(url)
    os.environ["TEST_DATABASE_URL"] = url
    os.environ["DATABASE_URL"] = url
    # Prevent indefinite waits on DB locks in test subprocesses.
    os.environ.setdefault("PGOPTIONS", "-c lock_timeout=5000 -c statement_timeout=120000")
    # Fixtures that reset schema terminate other connections to the same DB; avoid sharing the
    # default DATABASE_URL with a live uvicorn instance or migrations may appear flaky.


@pytest.fixture(scope="session")
def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def test_db_url() -> str:
    return _resolve_test_database_url()


@pytest.fixture(scope="session")
def db_engine(test_db_url: str) -> Engine:
    # NullPool: avoid reusing pooled connections across DROP SCHEMA / TRUNCATE boundaries
    # (stale sockets and "server closed the connection unexpectedly" during DDL).
    engine = create_engine(
        test_db_url,
        poolclass=NullPool,
        pool_pre_ping=True,
        connect_args={"application_name": "pytest-gdc"},
    )
    try:
        yield engine
    finally:
        engine.dispose()


def _terminate_other_connections(engine: Engine, db_url: str) -> None:
    db_name = _database_name_from_url(db_url)
    if not db_name:
        return
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) "
                "FROM pg_stat_activity "
                "WHERE datname = :db_name "
                "AND pid <> pg_backend_pid()"
            ),
            {"db_name": db_name},
        )


def _reset_public_schema(engine: Engine) -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


def _alembic_upgrade_head(test_db_url: str, project_root: Path) -> None:
    cfg = Config(str(project_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(project_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", test_db_url)
    command.upgrade(cfg, "head")


def _alembic_version_table_exists(engine: Engine) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'alembic_version' LIMIT 1"
            )
        ).first()
        return row is not None


def _alembic_applied_revision(engine: Engine) -> str | None:
    if not _alembic_version_table_exists(engine):
        return None
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
    return str(row) if row else None


def _public_schema_has_core_tables(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = 'connectors')"
                )
            ).scalar()
        )


def _ensure_public_schema_at_revision_head(engine: Engine, test_db_url: str, project_root: Path) -> None:
    """Create schema via Alembic when missing; upgrade to head when revision is recorded."""

    applied = _alembic_applied_revision(engine)
    if applied is None:
        if _public_schema_has_core_tables(engine) or not _alembic_version_table_exists(engine):
            _terminate_other_connections(engine, test_db_url)
            _reset_public_schema(engine)
        _alembic_upgrade_head(test_db_url, project_root)
        engine.dispose()
        return
    _alembic_upgrade_head(test_db_url, project_root)


def _quote_pg_ident(name: str) -> str:
    """Quote a PostgreSQL identifier (tablename from pg_catalog only)."""

    return '"' + str(name).replace('"', '""') + '"'


def _truncate_public_tables(engine: Engine) -> None:
    """Clear application data without dropping tables or indexes."""

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
        ).fetchall()
    if not rows:
        return
    table_list = ", ".join(f"public.{_quote_pg_ident(str(r[0]))}" for r in rows)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def reset_db_schema(db_engine: Engine, test_db_url: str) -> None:
    """Full destructive reset (rare); callers must expect a cold public schema."""

    with _schema_ddl_lock:
        _terminate_other_connections(db_engine, test_db_url)
        _reset_public_schema(db_engine)
        db_engine.dispose()


@pytest.fixture()
def reset_db(db_engine: Engine, test_db_url: str, project_root: Path) -> None:
    """Ensure migrated tables exist, then truncate (fast per-test isolation)."""

    with _schema_ddl_lock:
        _ensure_public_schema_at_revision_head(db_engine, test_db_url, project_root)
        _truncate_public_tables(db_engine)


@pytest.fixture()
def db_session(reset_db: None, db_engine: Engine) -> Session:
    # expire_on_commit=False avoids flaky "Could not refresh instance" when route
    # handlers commit inside the same Session yielded to TestClient dependencies.
    session = sessionmaker(bind=db_engine, autocommit=False, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def migrated_db_session(reset_db: None, db_engine: Engine) -> Session:
    """Same physical schema as ``db_session`` (Alembic head + truncated data)."""

    session = sessionmaker(bind=db_engine, autocommit=False, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
