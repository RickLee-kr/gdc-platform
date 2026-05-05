from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

PG_URL = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@localhost:5432/gdc")

def _upgrade_head_postgres_db() -> tuple[str, Session]:
    db_url = PG_URL
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    os.environ["DATABASE_URL"] = db_url
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    session = sessionmaker(bind=engine, autocommit=False, autoflush=False)()
    return db_url, session


def _seed_test_rows(db: Session) -> None:
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
    db.flush()

    destination = Destination(
        name="d1",
        destination_type="WEBHOOK_POST",
        config_json={},
        rate_limit_json={},
        enabled=True,
    )
    db.add(destination)
    db.flush()

    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="RUNNING",
    )
    db.add(route)

    db.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db.commit()


def test_checkpoint_lookup_performance() -> None:
    db_url, db = _upgrade_head_postgres_db()
    _seed_test_rows(db)

    inspector = inspect(create_engine(db_url))
    checkpoint_indexes = {idx["name"] for idx in inspector.get_indexes("checkpoints")}
    route_indexes = {idx["name"] for idx in inspector.get_indexes("routes")}
    log_indexes = {idx["name"] for idx in inspector.get_indexes("delivery_logs")}

    assert "uq_checkpoints_stream_id" in checkpoint_indexes
    assert "idx_routes_stream_enabled" in route_indexes
    assert "idx_logs_stream_id_created_at" in log_indexes

    plan = db.execute(
        text(
            "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) "
            "SELECT * FROM checkpoints WHERE stream_id = 1"
        )
    ).fetchall()
    plan_str = str(plan)
    assert "uq_checkpoints_stream_id" in plan_str
