"""SQLAlchemy engine, session, and Base for PostgreSQL runtime."""

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings

DATABASE_URL = settings.DATABASE_URL

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


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
