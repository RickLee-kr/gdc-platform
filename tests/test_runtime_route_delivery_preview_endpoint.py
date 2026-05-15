"""Route delivery preview API — DB-backed route/destination, no send, no DB writes."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.destinations.models import Destination
from app.formatters.config_resolver import resolve_formatter_config
from app.formatters.message_prefix import DEFAULT_MESSAGE_PREFIX_TEMPLATE, compact_event_json
from app.main import app
from app.connectors.models import Connector
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def _seed_minimal_stream_route_destination(
    db: Session,
    *,
    destination_type: str,
    destination_config: dict[str, Any],
    route_formatter: dict[str, Any],
    route_enabled: bool = True,
    destination_enabled: bool = True,
) -> tuple[int, int]:
    connector = Connector(name="rdp-connector", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="rdp-stream",
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
        name="rdp-dest",
        destination_type=destination_type,
        config_json=destination_config,
        rate_limit_json={},
        enabled=destination_enabled,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=route_enabled,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json=route_formatter,
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    db.refresh(destination)
    return route.id, destination.id


@pytest.fixture
def route_delivery_client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_route_delivery_preview_syslog_udp_success(route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, dest_id = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="SYSLOG_UDP",
        destination_config={
            "host": "10.0.0.1",
            "port": 5514,
            "protocol": "udp",
            "formatter_config": {
                "message_format": "json",
                "syslog": {"hostname": "gdc", "app_name": "generic-connector", "tag": "udp_tag"},
            },
        },
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={
            "route_id": route_id,
            "events": [{"event_id": "evt-1", "message": "hello"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["route_id"] == route_id
    assert body["destination_id"] == dest_id
    assert body["destination_type"] == "SYSLOG_UDP"
    assert body["route_enabled"] is True
    assert body["destination_enabled"] is True
    assert body["message_count"] == 1
    evt = {"event_id": "evt-1", "message": "hello"}
    assert body["preview_messages"][0] == f"{DEFAULT_MESSAGE_PREFIX_TEMPLATE.rstrip()} {compact_event_json(evt)}"
    assert body["resolved_formatter_config"]["syslog"]["tag"] == "udp_tag"
    assert body["resolved_formatter_config"]["message_prefix_enabled"] is True


def test_route_delivery_preview_webhook_post_success(route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, dest_id = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://receiver.example.com/hook"},
        route_formatter={"message_format": "json"},
    )
    events = [{"a": 1}, {"b": 2}]
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": events},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "WEBHOOK_POST"
    assert body["destination_id"] == dest_id
    assert body["preview_messages"] == events
    assert body["resolved_formatter_config"]["message_format"] == "json"


def test_route_delivery_preview_webhook_post_batch_array(route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, dest_id = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={
            "url": "https://receiver.example.com/hook",
            "payload_mode": "BATCH_JSON_ARRAY",
        },
        route_formatter={"message_format": "json"},
    )
    events = [{"a": 1}, {"b": 2}]
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": events},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "WEBHOOK_POST"
    assert body["destination_id"] == dest_id
    assert body["preview_messages"] == [events]
    assert body["message_count"] == 1


def test_route_formatter_override_beats_destination_formatter(
    route_delivery_client: TestClient,
    db_session: Session,
) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="SYSLOG_TCP",
        destination_config={
            "formatter_config": {
                "message_format": "json",
                "syslog": {"tag": "dest_only", "hostname": "h1"},
            },
        },
        route_formatter={
            "message_format": "json",
            "syslog": {"tag": "route_wins", "hostname": "h1"},
        },
    )
    route = db_session.query(Route).filter(Route.id == route_id).one()
    dest = db_session.query(Destination).filter(Destination.id == route.destination_id).one()
    resolved = resolve_formatter_config(dest.config_json or {}, route.formatter_config_json or None)
    assert resolved["syslog"]["tag"] == "route_wins"

    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{"x": 1}]},
    )
    assert response.status_code == 200
    preview = response.json()["preview_messages"][0]
    assert preview.startswith(f"{DEFAULT_MESSAGE_PREFIX_TEMPLATE.rstrip()} ")
    assert "dest_only" not in preview
    assert response.json()["resolved_formatter_config"]["syslog"]["tag"] == "route_wins"


def test_route_delivery_preview_route_not_found(route_delivery_client: TestClient, db_session: Session) -> None:
    _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": 999_999, "events": [{}]},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "ROUTE_NOT_FOUND"


def test_route_delivery_preview_destination_disabled(route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
        destination_enabled=False,
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "DESTINATION_DISABLED"


def test_route_delivery_preview_route_disabled(route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
        route_enabled=False,
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "ROUTE_DISABLED"


def test_route_delivery_preview_invalid_event_item_returns_422(
    route_delivery_client: TestClient, db_session: Session
) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": ["not-a-dict"]},
    )
    assert response.status_code == 422


def test_route_delivery_preview_events_not_list_returns_422(
    route_delivery_client: TestClient, db_session: Session
) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": {"x": 1}},
    )
    assert response.status_code == 422


def test_route_delivery_preview_does_not_call_senders(monkeypatch: pytest.MonkeyPatch, route_delivery_client: TestClient, db_session: Session) -> None:
    calls = {"syslog": 0, "webhook": 0}

    def _no_syslog_send(*args: Any, **kwargs: Any) -> None:
        calls["syslog"] += 1

    def _no_webhook_send(*args: Any, **kwargs: Any) -> None:
        calls["webhook"] += 1

    monkeypatch.setattr("app.delivery.syslog_sender.SyslogSender.send", _no_syslog_send)
    monkeypatch.setattr("app.delivery.webhook_sender.WebhookSender.send", _no_webhook_send)

    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="SYSLOG_UDP",
        destination_config={"formatter_config": {"message_format": "json"}},
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{"x": 1}]},
    )
    assert response.status_code == 200
    assert calls["syslog"] == 0
    assert calls["webhook"] == 0


def test_route_delivery_preview_does_not_commit_or_rollback(monkeypatch: pytest.MonkeyPatch, route_delivery_client: TestClient, db_session: Session) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="WEBHOOK_POST",
        destination_config={"url": "https://x"},
        route_formatter={},
    )

    commit_calls = {"n": 0}
    real_commit = Session.commit

    def _counting_commit(self: Any, *args: Any, **kwargs: Any) -> None:
        commit_calls["n"] += 1
        return real_commit(self, *args, **kwargs)

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _counting_commit)

    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{"n": 1}]},
    )
    assert response.status_code == 200
    assert commit_calls["n"] == 0


def test_route_delivery_preview_unsupported_destination_type(
    route_delivery_client: TestClient,
    db_session: Session,
) -> None:
    route_id, _ = _seed_minimal_stream_route_destination(
        db_session,
        destination_type="S3_PUT",
        destination_config={"bucket": "b"},
        route_formatter={},
    )
    response = route_delivery_client.post(
        "/api/v1/runtime/preview/route-delivery",
        json={"route_id": route_id, "events": [{}]},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "UNSUPPORTED_DESTINATION_TYPE"
