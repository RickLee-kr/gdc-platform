"""SQLAlchemy engine, session, and Base for PostgreSQL runtime."""

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings

DATABASE_URL = settings.DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=max(1, int(settings.GDC_DB_POOL_SIZE)),
    max_overflow=max(0, int(settings.GDC_DB_MAX_OVERFLOW)),
    pool_timeout=max(5, int(settings.GDC_DB_POOL_TIMEOUT)),
    pool_recycle=max(300, int(settings.GDC_DB_POOL_RECYCLE_SEC)),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from app.observability.slow_query import install_engine_listeners  # noqa: E402

install_engine_listeners(engine)

Base = declarative_base()

# Bounded reads for dashboard / entity list GET handlers (PostgreSQL cancels long queries).
_GDC_READ_STATEMENT_TIMEOUT_MS = 8000


def utcnow() -> datetime:
    """UTC timestamp helper for model defaults/onupdate."""

    return datetime.now(timezone.utc)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a DB session."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_read_bounded() -> Generator[Session, None, None]:
    """Like ``get_db`` but sets ``SET LOCAL statement_timeout`` for this transaction (read-only list pages)."""

    db = SessionLocal()
    try:
        db.execute(text(f"SET LOCAL statement_timeout = '{int(_GDC_READ_STATEMENT_TIMEOUT_MS)}ms'"))
        yield db
    finally:
        db.close()
