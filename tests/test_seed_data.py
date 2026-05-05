from __future__ import annotations

import os

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import Base
from app.db.seed import seed_dev_data
from app.destinations.models import Destination
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.streams.models import Stream

PG_URL = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@localhost:5432/gdc")


def _make_db():
    engine = create_engine(PG_URL)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return SessionLocal()


def test_seed_dev_data_idempotent_and_loadable_context() -> None:
    db = _make_db()

    first = seed_dev_data(db)
    second = seed_dev_data(db)

    assert first["connector_id"] == second["connector_id"]
    assert first["stream_id"] == second["stream_id"]
    assert first["route_id"] == second["route_id"]
    assert first["checkpoint_id"] == second["checkpoint_id"]

    connector_count = db.query(func.count(Connector.id)).scalar()
    stream_count = db.query(func.count(Stream.id)).scalar()
    destination_count = db.query(func.count(Destination.id)).scalar()
    route_count = db.query(func.count(Route.id)).scalar()
    checkpoint_count = db.query(func.count(Checkpoint.id)).scalar()

    assert connector_count == 1
    assert stream_count == 1
    assert destination_count == 1
    assert route_count == 1
    assert checkpoint_count == 1

    context = load_stream_context(db, first["stream_id"])
    assert context.checkpoint == {"type": "EVENT_ID", "value": {"last_event_id": None}}
    assert context.routes
    assert context.routes[0]["destination"]["destination_type"] == "WEBHOOK_POST"
    assert context.destinations_by_route

    assert first["connector_id"] > 0
    assert first["stream_id"] > 0
    assert first["route_id"] > 0
    assert first["checkpoint_id"] > 0
