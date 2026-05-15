from __future__ import annotations

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

def test_models_import_after_schema_reset(reset_db: None) -> None:
    """Schema is applied via Alembic migrations + ``reset_db`` truncate (see ``tests/conftest.py``)."""
    assert reset_db is None


def test_create_full_model_chain(db_session: Session) -> None:
    db = db_session

    connector = Connector(name="connector-a", description="desc", status="RUNNING")
    db.add(connector)
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={"token": "secret"},
        enabled=True,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="stream-a",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/events"},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 10},
    )
    db.add(stream)
    db.flush()

    mapping = Mapping(
        stream_id=stream.id,
        event_array_path="$.items",
        field_mappings_json={"event_id": "$.id"},
        raw_payload_mode="JSON",
    )
    enrichment = Enrichment(
        stream_id=stream.id,
        enrichment_json={"vendor": "Acme"},
        override_policy="KEEP_EXISTING",
        enabled=True,
    )
    destination = Destination(
        name="dest-a",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver.example.com"},
        rate_limit_json={"eps": 100},
        enabled=True,
    )
    db.add_all([mapping, enrichment, destination])
    db.flush()

    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    checkpoint = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="CUSTOM_FIELD",
        checkpoint_value_json={"last_id": "42"},
    )
    db.add_all([route, checkpoint])
    db.flush()

    log = DeliveryLog(
        connector_id=connector.id,
        stream_id=stream.id,
        route_id=route.id,
        destination_id=destination.id,
        stage="route",
        level="INFO",
        status="OK",
        message="delivered",
        payload_sample={"event_id": "1"},
        retry_count=0,
        http_status=200,
        latency_ms=10,
        error_code=None,
    )
    db.add(log)
    db.commit()

    assert connector.id is not None
    assert source.id is not None
    assert stream.id is not None
    assert route.id is not None
    assert checkpoint.id is not None
    assert log.id is not None
