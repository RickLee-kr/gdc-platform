from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_delivery_format_draft_preview_syslog_udp_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-1", "message": "hello"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": {
                "message_format": "json",
                "syslog": {"hostname": "gdc", "app_name": "generic-connector", "tag": "acme_edr"},
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 1
    assert body["preview_event_count"] == 1
    assert body["destination_type"] == "SYSLOG_UDP"
    assert body["preview_messages"][0].startswith("<134> gdc generic-connector acme_edr: ")


def test_delivery_format_draft_preview_syslog_tcp_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-2", "message": "world"}],
            "destination_type": "SYSLOG_TCP",
            "formatter_config": {
                "message_format": "json",
                "syslog": {"hostname": "gdc", "app_name": "generic-connector", "tag": "acme_edr"},
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "SYSLOG_TCP"
    assert body["preview_event_count"] == 1


def test_delivery_format_draft_preview_webhook_post_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-3", "message": "webhook"}],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "WEBHOOK_POST"
    assert body["preview_messages"] == [{"event_id": "evt-3", "message": "webhook"}]


def test_delivery_format_draft_preview_max_events_limit_applied() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": f"e{i}"} for i in range(7)],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
            "max_events": 3,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["input_event_count"] == 7
    assert body["preview_event_count"] == 3
    assert len(body["preview_messages"]) == 3


def test_delivery_format_draft_preview_final_events_not_list_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": {"event_id": "evt-1"},
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert response.status_code == 422


def test_delivery_format_draft_preview_final_events_item_not_dict_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": ["not-dict"],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert response.status_code == 422


def test_delivery_format_draft_preview_webhook_batch_payload_mode() -> None:
    client = TestClient(app)
    events = [{"a": 1}, {"b": 2}]
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": events,
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
            "payload_mode": "BATCH_JSON_ARRAY",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["preview_messages"] == [events]


def test_delivery_format_draft_preview_unsupported_destination_type_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-1"}],
            "destination_type": "S3_PUT",
            "formatter_config": {},
        },
    )
    assert response.status_code == 422


def test_delivery_format_draft_preview_formatter_config_not_dict_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-1"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": "invalid",
        },
    )
    assert response.status_code == 422


def test_delivery_format_draft_preview_does_not_use_db_commit_or_rollback(monkeypatch) -> None:
    called = {"commit": 0, "rollback": 0}

    def _raise_commit(*args, **kwargs):  # noqa: ANN002, ANN003
        called["commit"] += 1
        raise AssertionError("DB commit should not be called")

    def _raise_rollback(*args, **kwargs):  # noqa: ANN002, ANN003
        called["rollback"] += 1
        raise AssertionError("DB rollback should not be called")

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _raise_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _raise_rollback)
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/delivery-format-draft",
        json={
            "final_events": [{"event_id": "evt-1", "message": "hello"}],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert response.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0


def test_format_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-3", "message": "webhook"}],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )
    assert response.status_code == 200
    assert response.json()["message_count"] == 1


def test_final_event_draft_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/final-event-draft",
        json={
            "payload": {"items": [{"id": "evt-1"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {"vendor": "Acme"},
            "override_policy": "KEEP_EXISTING",
        },
    )
    assert response.status_code == 200
    assert response.json()["final_events"][0]["event_id"] == "evt-1"


def test_mapping_draft_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping-draft",
        json={
            "payload": {"id": "evt-1"},
            "field_mappings": {"event_id": "$.id"},
        },
    )
    assert response.status_code == 200
    assert response.json()["mapped_events"][0]["event_id"] == "evt-1"


def test_mapping_preview_endpoint_regression_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/mapping",
        json={
            "raw_response": {"items": [{"id": "evt-1"}]},
            "event_array_path": "$.items",
            "field_mappings": {"event_id": "$.id"},
            "enrichment": {},
            "override_policy": "KEEP_EXISTING",
        },
    )
    assert response.status_code == 200
    assert response.json()["preview_events"][0]["event_id"] == "evt-1"
