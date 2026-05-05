"""Development seed data for Generic Data Connector Platform."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import SessionLocal
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def seed_dev_data(db: Session) -> dict[str, int]:
    """Create idempotent development seed data."""

    connector = db.query(Connector).filter(Connector.name == "Sample API Connector").first()
    if connector is None:
        connector = Connector(name="Sample API Connector", description="Development seed connector", status="RUNNING")
        db.add(connector)
        db.flush()
    else:
        connector.status = "RUNNING"
        db.add(connector)
        db.flush()

    source = db.query(Source).filter(Source.connector_id == connector.id, Source.source_type == "HTTP_API_POLLING").first()
    if source is None:
        source = Source(
            connector_id=connector.id,
            source_type="HTTP_API_POLLING",
            config_json={"base_url": "https://api.example.com"},
            auth_json={"Authorization": "Bearer sample-token"},
            enabled=True,
        )
        db.add(source)
        db.flush()
    else:
        source.config_json = {"base_url": "https://api.example.com"}
        source.auth_json = {"Authorization": "Bearer sample-token"}
        source.enabled = True
        db.add(source)
        db.flush()

    stream = db.query(Stream).filter(Stream.source_id == source.id, Stream.name == "Sample Alerts Stream").first()
    if stream is None:
        stream = Stream(
            connector_id=connector.id,
            source_id=source.id,
            name="Sample Alerts Stream",
            stream_type="HTTP_API_POLLING",
            config_json={"endpoint": "/alerts", "method": "GET", "event_array_path": "$.items"},
            polling_interval=60,
            enabled=True,
            status="RUNNING",
            rate_limit_json={"max_requests": 60, "per_seconds": 60},
        )
        db.add(stream)
        db.flush()
    else:
        stream.connector_id = connector.id
        stream.stream_type = "HTTP_API_POLLING"
        stream.config_json = {"endpoint": "/alerts", "method": "GET", "event_array_path": "$.items"}
        stream.polling_interval = 60
        stream.enabled = True
        stream.status = "RUNNING"
        stream.rate_limit_json = {"max_requests": 60, "per_seconds": 60}
        db.add(stream)
        db.flush()

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream.id).first()
    mapping_payload = {
        "event_id": "$.id",
        "severity": "$.severity",
        "message": "$.message",
        "created_at": "$.created_at",
    }
    if mapping is None:
        mapping = Mapping(
            stream_id=stream.id,
            event_array_path="$.items",
            field_mappings_json=mapping_payload,
            raw_payload_mode="JSON",
        )
        db.add(mapping)
    else:
        mapping.event_array_path = "$.items"
        mapping.field_mappings_json = mapping_payload
        mapping.raw_payload_mode = "JSON"
        db.add(mapping)
    db.flush()

    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream.id).first()
    enrichment_payload = {
        "vendor": "SampleVendor",
        "product": "SampleProduct",
        "log_type": "sample_alert",
        "event_source": "sample_api_alerts",
        "collector_name": "generic-connector-01",
        "tenant": "default",
    }
    if enrichment is None:
        enrichment = Enrichment(
            stream_id=stream.id,
            enrichment_json=enrichment_payload,
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
        db.add(enrichment)
    else:
        enrichment.enrichment_json = enrichment_payload
        enrichment.override_policy = "KEEP_EXISTING"
        enrichment.enabled = True
        db.add(enrichment)
    db.flush()

    destination = db.query(Destination).filter(Destination.name == "Sample Webhook Destination").first()
    if destination is None:
        destination = Destination(
            name="Sample Webhook Destination",
            destination_type="WEBHOOK_POST",
            config_json={
                "url": "https://receiver.example.com/events",
                "method": "POST",
                "headers": {"Content-Type": "application/json"},
                "timeout_seconds": 30,
            },
            rate_limit_json={"max_events": 100, "per_seconds": 1},
            enabled=True,
        )
        db.add(destination)
    else:
        destination.destination_type = "WEBHOOK_POST"
        destination.config_json = {
            "url": "https://receiver.example.com/events",
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "timeout_seconds": 30,
        }
        destination.rate_limit_json = {"max_events": 100, "per_seconds": 1}
        destination.enabled = True
        db.add(destination)
    db.flush()

    route = (
        db.query(Route)
        .filter(Route.stream_id == stream.id, Route.destination_id == destination.id)
        .first()
    )
    if route is None:
        route = Route(
            stream_id=stream.id,
            destination_id=destination.id,
            enabled=True,
            failure_policy="LOG_AND_CONTINUE",
            formatter_config_json={"format": "json"},
            rate_limit_json={"max_events": 100, "per_seconds": 1},
            status="ENABLED",
        )
        db.add(route)
    else:
        route.enabled = True
        route.failure_policy = "LOG_AND_CONTINUE"
        route.formatter_config_json = {"format": "json"}
        route.rate_limit_json = {"max_events": 100, "per_seconds": 1}
        route.status = "ENABLED"
        db.add(route)
    db.flush()

    checkpoint = db.query(Checkpoint).filter(Checkpoint.stream_id == stream.id).first()
    if checkpoint is None:
        checkpoint = Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_event_id": None},
        )
        db.add(checkpoint)
    else:
        checkpoint.checkpoint_type = "EVENT_ID"
        checkpoint.checkpoint_value_json = {"last_event_id": None}
        db.add(checkpoint)
    db.commit()
    db.refresh(route)
    db.refresh(checkpoint)

    return {
        "connector_id": connector.id,
        "source_id": source.id,
        "stream_id": stream.id,
        "destination_id": destination.id,
        "route_id": route.id,
        "checkpoint_id": checkpoint.id,
    }


def _run_seed_cli() -> None:
    db = SessionLocal()
    try:
        result = seed_dev_data(db)
        print(result)
    finally:
        db.close()


if __name__ == "__main__":
    _run_seed_cli()
