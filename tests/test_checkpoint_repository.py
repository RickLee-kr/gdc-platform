from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.checkpoints import repository as repo
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import Base
from app.sources.models import Source
from app.streams.models import Stream

PG_URL = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@localhost:5432/gdc")


def _make_db() -> Session:
    engine = create_engine(PG_URL)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)()


def _seed_stream(db: Session) -> Stream:
    connector = Connector(name="c1", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(connector_id=connector.id, source_type="HTTP_API_POLLING", config_json={}, auth_json={}, enabled=True)
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="s1",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.commit()
    db.refresh(stream)
    return stream


def test_get_checkpoint_by_stream_id() -> None:
    db = _make_db()
    stream = _seed_stream(db)
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db.commit()

    found = repo.get_checkpoint_by_stream_id(db, stream.id)
    assert found is not None
    assert found.stream_id == stream.id
    assert found.checkpoint_value_json == {"x": 1}


def test_upsert_checkpoint_updates_existing() -> None:
    db = _make_db()
    stream = _seed_stream(db)
    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db.commit()

    row = repo.upsert_checkpoint(db, stream.id, "CUSTOM_FIELD", {"x": 2})
    assert row.checkpoint_value_json == {"x": 2}


def test_upsert_checkpoint_inserts_when_missing() -> None:
    db = _make_db()
    stream = _seed_stream(db)
    row = repo.upsert_checkpoint(db, stream.id, "CUSTOM_FIELD", {"k": "v"})
    assert row.stream_id == stream.id
    assert row.checkpoint_value_json == {"k": "v"}
