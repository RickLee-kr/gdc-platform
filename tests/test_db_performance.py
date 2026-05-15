from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


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


def test_checkpoint_lookup_performance(migrated_db_session: Session, db_engine: Engine) -> None:
    db = migrated_db_session
    _seed_test_rows(db)

    inspector = inspect(db_engine)
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
