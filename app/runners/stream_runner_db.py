"""Short-lived SQLAlchemy sessions for StreamRunner (avoid idle-in-transaction)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Callable, Generator, TypeVar

from sqlalchemy.orm import Session

from app.database import SessionLocal

T = TypeVar("T")


@contextmanager
def short_db_session(*, commit: bool = False) -> Generator[Session, None, None]:
    """Open a DB session, optionally commit on success, always close on exit."""

    db = SessionLocal()
    try:
        yield db
        if commit:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_with_db(fn: Callable[[Session], T], *, commit: bool = False) -> T:
    """Run ``fn(db)`` inside a short-lived session."""

    with short_db_session(commit=commit) as db:
        return fn(db)
