"""GET /runtime/streams/{id}/webhook-ingest — delivery_logs aggregation for push ingest."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.logs.models import DeliveryLog
from app.main import app
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream

UTC = timezone.utc


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    def _override_db() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


def _seed_webhook_stream(db: Session) -> dict[str, object]:
    connector = Connector(name="wh-obs", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="WEBHOOK_RECEIVER",
        config_json={"receiver_key": "obs-key", "max_request_bytes": 65536},
        auth_json={"auth_mode": "shared_secret_header", "header_name": "X-Test", "shared_secret": "s"},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="wh-obs-stream",
        stream_type="WEBHOOK_RECEIVER",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    dest = Destination(
        name="wh-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://example.com/hook"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(dest)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=dest.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.flush()
    return {"stream": stream, "source": source, "route": route, "connector": connector}


def test_webhook_ingest_observability_aggregates_delivery_logs(client: TestClient, db_session: Session) -> None:
    ctx = _seed_webhook_stream(db_session)
    stream = ctx["stream"]
    assert isinstance(stream, Stream)
    route = ctx["route"]
    now = datetime.now(UTC)
    run_id = "run-wh-obs-1"
    rows = [
        DeliveryLog(
            connector_id=int(stream.connector_id),
            stream_id=int(stream.id),
            route_id=None,
            destination_id=None,
            stage="run_started",
            level="INFO",
            status="started",
            message="run started",
            run_id=run_id,
            created_at=now - timedelta(minutes=5),
        ),
        DeliveryLog(
            connector_id=int(stream.connector_id),
            stream_id=int(stream.id),
            route_id=int(route.id),
            destination_id=int(route.destination_id),
            stage="route_send_success",
            level="INFO",
            status="success",
            message="delivered",
            run_id=run_id,
            created_at=now - timedelta(minutes=4),
        ),
        DeliveryLog(
            connector_id=int(stream.connector_id),
            stream_id=int(stream.id),
            route_id=int(route.id),
            destination_id=int(route.destination_id),
            stage="run_complete",
            level="INFO",
            status="success",
            message="run complete",
            payload_sample={"input_events": 2, "partial_success": False},
            run_id=run_id,
            created_at=now - timedelta(minutes=3),
        ),
    ]
    db_session.add_all(rows)
    db_session.commit()

    resp = client.get(f"/api/v1/runtime/streams/{stream.id}/webhook-ingest?window=1h")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stream_id"] == int(stream.id)
    assert body["receiver_path"] == "/api/v1/ingest/webhook/obs-key"
    assert body["webhook_auth_mode"] == "shared_secret_header"
    assert body["ingest_attempts"] == 1
    assert body["successful_deliveries"] == 1
    assert body["failed_deliveries"] == 0
    assert body["recent_ingest"]["outcome"] == "success"
    assert len(body["recent_logs"]) >= 1


def test_webhook_ingest_observability_rejects_http_polling_stream(client: TestClient, db_session: Session) -> None:
    connector = Connector(name="http-only", description=None, status="RUNNING")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="http-stream",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db_session.add(stream)
    db_session.commit()

    resp = client.get(f"/api/v1/runtime/streams/{stream.id}/webhook-ingest")
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "STREAM_NOT_WEBHOOK_RECEIVER"
