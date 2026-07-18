from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import get_db
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.logs.models import DeliveryLog
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    def _override_db() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def sent_webhook_batches(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def _send(self: object, events: list[dict[str, Any]], config: dict[str, Any], *args: Any, **kwargs: Any) -> None:
        calls.append({"events": events, "config": config})
        if config.get("url") == "https://receiver-fail.example.com/events":
            raise RuntimeError("synthetic destination failure")

    monkeypatch.setattr("app.delivery.webhook_sender.WebhookSender.send", _send)
    return calls


def _seed_webhook_stream(
    db: Session,
    *,
    receiver_key: str = "rx-test",
    auth_mode: str = "shared_secret_header",
    shared_secret: str = "secret-1",
    bearer_token: str = "token-1",
    event_array_path: str | None = None,
    enabled_source: bool = True,
    enabled_stream: bool = True,
    route_urls: list[str] | None = None,
    failure_policies: list[str] | None = None,
) -> dict[str, Any]:
    connector = Connector(name=f"Webhook {receiver_key}", description="webhook test", status="RUNNING")
    db.add(connector)
    db.flush()

    auth_json: dict[str, Any] = {"auth_mode": auth_mode}
    if auth_mode == "shared_secret_header":
        auth_json["shared_secret"] = shared_secret
        auth_json["header_name"] = "X-GDC-Webhook-Secret"
    if auth_mode == "bearer_token":
        auth_json["bearer_token"] = bearer_token

    source = Source(
        connector_id=connector.id,
        source_type="WEBHOOK_RECEIVER",
        config_json={
            "receiver_key": receiver_key,
            "max_request_bytes": 1_048_576,
            "auth_header_name": "X-GDC-Webhook-Secret",
        },
        auth_json=auth_json,
        enabled=enabled_source,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name=f"Webhook Stream {receiver_key}",
        stream_type="WEBHOOK_RECEIVER",
        config_json={},
        polling_interval=60,
        enabled=enabled_stream,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()

    if event_array_path is not None:
        source.config_json = {**source.config_json, "stream_id": stream.id}

    mapping = Mapping(
        stream_id=stream.id,
        event_array_path=event_array_path,
        field_mappings_json={"event_id": "$.id", "message": "$.message"},
        raw_payload_mode="JSON",
    )
    enrichment = Enrichment(
        stream_id=stream.id,
        enrichment_json={"vendor": "WebhookVendor"},
        override_policy="KEEP_EXISTING",
        enabled=True,
    )
    db.add_all([mapping, enrichment])
    db.flush()

    urls = route_urls or ["https://receiver-ok.example.com/events"]
    policies = failure_policies or ["LOG_AND_CONTINUE" for _ in urls]
    routes: list[Route] = []
    for idx, url in enumerate(urls):
        dest = Destination(
            name=f"webhook-dest-{idx}",
            destination_type="WEBHOOK_POST",
            config_json={"url": url},
            rate_limit_json={},
            enabled=True,
        )
        db.add(dest)
        db.flush()
        route = Route(
            stream_id=stream.id,
            destination_id=dest.id,
            enabled=True,
            failure_policy=policies[idx],
            formatter_config_json={},
            rate_limit_json={},
            status="ENABLED",
        )
        db.add(route)
        db.flush()
        routes.append(route)

    checkpoint = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="EVENT_ID",
        checkpoint_value_json={"last_success_event": {"event_id": "before"}},
    )
    db.add(checkpoint)
    db.commit()
    return {
        "connector_id": connector.id,
        "source_id": source.id,
        "stream_id": stream.id,
        "route_ids": [route.id for route in routes],
    }


def _logs(db: Session, stream_id: int) -> list[DeliveryLog]:
    return db.query(DeliveryLog).filter(DeliveryLog.stream_id == stream_id).order_by(DeliveryLog.id.asc()).all()


def test_authenticated_webhook_json_object_ingest_reuses_pipeline(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    seeded = _seed_webhook_stream(db_session)

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={"id": "evt-1", "message": "hello"},
        headers={"X-GDC-Webhook-Secret": "secret-1"},
    )

    assert response.status_code == 200
    assert len(sent_webhook_batches) == 1
    delivered = sent_webhook_batches[0]["events"][0]
    assert delivered["event_id"] == "evt-1"
    assert delivered["message"] == "hello"
    assert delivered["vendor"] == "WebhookVendor"
    assert delivered.get("classification_level") == "INTERNAL"
    checkpoint = db_session.query(Checkpoint).filter(Checkpoint.stream_id == seeded["stream_id"]).one()
    assert checkpoint.checkpoint_value_json == {"last_success_event": {"event_id": "before"}}
    rows = _logs(db_session, seeded["stream_id"])
    assert any(row.stage == "route_send_success" for row in rows)
    assert any(row.stage == "run_complete" for row in rows)
    assert not any(row.stage == "checkpoint_update" for row in rows)


def test_webhook_invalid_auth_rejected_and_logged(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logged: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "app.runners.webhook_receiver.logger.warning",
        lambda _fmt, payload: logged.append(payload),
    )
    _seed_webhook_stream(db_session)

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={"id": "evt-bad-auth", "message": "no"},
        headers={"X-GDC-Webhook-Secret": "wrong"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error_code"] == "WEBHOOK_AUTH_FAILED"
    assert sent_webhook_batches == []
    assert any(item.get("stage") == "webhook_auth_failed" for item in logged)


@pytest.mark.parametrize(
    ("body", "headers", "expected_count"),
    [
        (
            json.dumps([{"id": "a1", "message": "one"}, {"id": "a2", "message": "two"}]),
            {"Content-Type": "application/json", "X-GDC-Webhook-Secret": "secret-1"},
            2,
        ),
        (
            '{"id":"n1","message":"one"}\n{"id":"n2","message":"two"}\n',
            {"Content-Type": "application/x-ndjson", "X-GDC-Webhook-Secret": "secret-1"},
            2,
        ),
    ],
)
def test_webhook_json_array_and_ndjson_ingest(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
    body: str,
    headers: dict[str, str],
    expected_count: int,
) -> None:
    _seed_webhook_stream(db_session)

    response = client.post("/api/v1/ingest/webhook/rx-test", content=body, headers=headers)

    assert response.status_code == 200
    assert len(sent_webhook_batches) == 1
    assert len(sent_webhook_batches[0]["events"]) == expected_count


def test_webhook_bearer_auth_and_event_array_path(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    _seed_webhook_stream(db_session, auth_mode="bearer_token", event_array_path="$.events")

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={"events": [{"id": "nested-1", "message": "inside"}]},
        headers={"Authorization": "Bearer token-1"},
    )

    assert response.status_code == 200
    assert sent_webhook_batches[0]["events"] == [
        {
            "event_id": "nested-1",
            "message": "inside",
            "vendor": "WebhookVendor",
            "classification_level": "INTERNAL",
        }
    ]


def test_webhook_no_auth_mode(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    _seed_webhook_stream(db_session, auth_mode="no_auth")

    response = client.post("/api/v1/ingest/webhook/rx-test", json={"id": "open-1", "message": "accepted"})

    assert response.status_code == 200
    assert sent_webhook_batches[0]["events"][0]["event_id"] == "open-1"


def test_webhook_multi_route_failure_isolation_and_delivery_logs(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    seeded = _seed_webhook_stream(
        db_session,
        route_urls=["https://receiver-ok.example.com/events", "https://receiver-fail.example.com/events"],
        failure_policies=["LOG_AND_CONTINUE", "LOG_AND_CONTINUE"],
    )

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={"id": "fanout-1", "message": "route isolation"},
        headers={"X-GDC-Webhook-Secret": "secret-1"},
    )

    assert response.status_code == 200
    assert len(sent_webhook_batches) == 2
    rows = _logs(db_session, seeded["stream_id"])
    assert sum(1 for row in rows if row.stage == "route_send_success") == 1
    assert sum(1 for row in rows if row.stage == "route_send_failed") == 1
    assert any(row.stage == "run_complete" for row in rows)


def test_webhook_invalid_payload_rejected_and_logged(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logged: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "app.runners.webhook_receiver.logger.warning",
        lambda _fmt, payload: logged.append(payload),
    )
    _seed_webhook_stream(db_session)

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        content="{not-json",
        headers={"Content-Type": "application/json", "X-GDC-Webhook-Secret": "secret-1"},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "WEBHOOK_INVALID_PAYLOAD"
    assert sent_webhook_batches == []
    assert any(item.get("stage") == "webhook_invalid_payload" for item in logged)


def test_webhook_disabled_stream_rejected(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    _seed_webhook_stream(db_session, enabled_stream=False)

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={"id": "disabled-1", "message": "blocked"},
        headers={"X-GDC-Webhook-Secret": "secret-1"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "WEBHOOK_RECEIVER_DISABLED"
    assert sent_webhook_batches == []


def test_webhook_correlation_field_survives_mapping(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    """e2e_correlation_id must remain available for collector correlation after mapping."""
    seeded = _seed_webhook_stream(db_session, auth_mode="no_auth")
    mapping = db_session.query(Mapping).filter(Mapping.stream_id == seeded["stream_id"]).one()
    mapping.field_mappings_json = {
        "event_id": "$.id",
        "message": "$.message",
        "e2e_correlation_id": "$.e2e_correlation_id",
    }
    db_session.add(mapping)
    db_session.commit()

    response = client.post(
        "/api/v1/ingest/webhook/rx-test",
        json={
            "id": "corr-1",
            "message": "keep-corr",
            "e2e_correlation_id": "full-e2e-corr-webhook-1",
        },
    )

    assert response.status_code == 200
    delivered = sent_webhook_batches[0]["events"][0]
    assert delivered["e2e_correlation_id"] == "full-e2e-corr-webhook-1"
    assert delivered["event_id"] == "corr-1"


def test_webhook_unknown_receiver_key_rejected(
    client: TestClient,
    db_session: Session,
    sent_webhook_batches: list[dict[str, Any]],
) -> None:
    _seed_webhook_stream(db_session)
    response = client.post(
        "/api/v1/ingest/webhook/does-not-exist",
        json={"id": "x", "message": "nope"},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "WEBHOOK_RECEIVER_NOT_FOUND"
    assert sent_webhook_batches == []
