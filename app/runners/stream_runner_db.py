"""Short-lived SQLAlchemy sessions for StreamRunner (avoid idle-in-transaction)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Generator, TypeVar

from sqlalchemy import text
from sqlalchemy.orm import Session, object_session

from app.database import SessionLocal

T = TypeVar("T")


@contextmanager
def short_db_session(*, commit: bool = False, read_only: bool | None = None) -> Generator[Session, None, None]:
    """Open a DB session, optionally commit on success, always close on exit."""

    use_read_only = read_only if read_only is not None else not commit
    db = SessionLocal()
    try:
        if use_read_only:
            db.execute(text("SET TRANSACTION READ ONLY"))
        yield db
        if commit:
            db.commit()
    except Exception:
        if db.in_transaction():
            db.rollback()
        raise
    finally:
        if db.in_transaction():
            db.rollback()
        db.close()


def run_with_db(fn: Callable[[Session], T], *, commit: bool = False) -> T:
    """Run ``fn(db)`` inside a short-lived session."""

    with short_db_session(commit=commit) as db:
        return fn(db)


def _expunge_if_present(db: Session, obj: Any) -> None:
    if obj is None:
        return
    try:
        if object_session(obj) is db:
            db.expunge(obj)
    except Exception:
        return


def expunge_runtime_orm_graph(db: Session, runtime_stream: Any, stream_arg: Any = None) -> None:
    """Detach loaded runtime ORM rows so ending the caller txn cannot force lazy-loads."""

    if not isinstance(db, Session) or not hasattr(db, "expunge"):
        return

    candidates: list[Any] = []
    if isinstance(runtime_stream, dict):
        for key in ("mapping_row", "enrichment_row", "source"):
            candidates.append(runtime_stream.get(key))
        for key in ("stream_protection_rules", "stream_classification_rules", "stream_policy_rules"):
            raw = runtime_stream.get(key)
            if isinstance(raw, list):
                candidates.extend(raw)
        for route in list(runtime_stream.get("routes") or []):
            if not isinstance(route, dict):
                continue
            for key in ("route_mapping_row", "route_enrichment_row"):
                candidates.append(route.get(key))
            for key in ("route_protection_rules", "route_classification_rules", "route_policy_rules"):
                raw = route.get(key)
                if isinstance(raw, list):
                    candidates.extend(raw)

    from app.runtime.stream_context import StreamContext

    if isinstance(stream_arg, StreamContext):
        candidates.extend([stream_arg.source, stream_arg.mapping, stream_arg.enrichment])
        dest_map = getattr(stream_arg, "destinations_by_route", None) or {}
        if isinstance(dest_map, dict):
            candidates.extend(dest_map.values())

    for obj in candidates:
        if isinstance(obj, list):
            for item in obj:
                _expunge_if_present(db, item)
        else:
            _expunge_if_present(db, obj)


def release_caller_transaction(
    db: Session | None,
    *,
    runtime_stream: Any = None,
    stream_arg: Any = None,
    end_with: str = "rollback",
) -> None:
    """End an open caller transaction without closing the session.

    Used so destination network I/O does not run while a request session is
    idle-in-transaction. Does not close or replace the caller-owned Session.

    ``end_with`` is ``\"commit\"`` or ``\"rollback\"``. Successful StreamRunner
    paths use commit so caller rollback counters stay at zero.
    """

    if db is None or not isinstance(db, Session):
        return
    if runtime_stream is not None or stream_arg is not None:
        expunge_runtime_orm_graph(db, runtime_stream, stream_arg)
    in_txn = getattr(db, "in_transaction", None)
    try:
        active = bool(in_txn()) if callable(in_txn) else False
    except Exception:
        active = False
    if not active:
        return
    try:
        if end_with == "commit" and hasattr(db, "commit"):
            db.commit()
        elif hasattr(db, "rollback"):
            db.rollback()
    except Exception:
        return
