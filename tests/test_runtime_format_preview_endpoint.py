from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_format_preview_syslog_udp_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-1", "message": "hello"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": {
                "message_format": "json",
                "syslog": {
                    "hostname": "gdc",
                    "app_name": "generic-connector",
                    "tag": "acme_edr",
                },
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "SYSLOG_UDP"
    assert body["message_count"] == 1
    assert (
        body["preview_messages"][0]
        == '<134> gdc generic-connector acme_edr: {"event_id":"evt-1","message":"hello"}'
    )


def test_format_preview_syslog_tcp_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-2", "message": "world"}],
            "destination_type": "SYSLOG_TCP",
            "formatter_config": {
                "message_format": "json",
                "syslog": {
                    "hostname": "gdc",
                    "app_name": "generic-connector",
                    "tag": "acme_edr",
                },
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["destination_type"] == "SYSLOG_TCP"
    assert body["message_count"] == 1
    assert body["preview_messages"][0].startswith("<134> gdc generic-connector acme_edr: ")


def test_format_preview_webhook_post_success() -> None:
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
    body = response.json()
    assert body["destination_type"] == "WEBHOOK_POST"
    assert body["message_count"] == 1
    assert body["preview_messages"] == [{"event_id": "evt-3", "message": "webhook"}]


def test_format_preview_unsupported_destination_returns_400() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-1"}],
            "destination_type": "S3_PUT",
            "formatter_config": {},
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error_code"] == "UNSUPPORTED_DESTINATION_TYPE"


def test_format_preview_invalid_event_item_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": ["not-a-dict"],
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )

    assert response.status_code == 422


def test_format_preview_events_not_list_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": {"not": "a-list"},
            "destination_type": "WEBHOOK_POST",
            "formatter_config": {},
        },
    )

    assert response.status_code == 422


def test_format_preview_invalid_formatter_config_type_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-1"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": "invalid",
        },
    )

    assert response.status_code == 422


def test_format_preview_syslog_flat_config_still_works() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-flat", "message": "ok"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": {
                "message_format": "json",
                "hostname": "gdc",
                "app_name": "generic-connector",
                "tag": "acme_edr",
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert (
        body["preview_messages"][0]
        == '<134> gdc generic-connector acme_edr: {"event_id":"evt-flat","message":"ok"}'
    )


def test_format_preview_does_not_use_db_commit_or_rollback(monkeypatch) -> None:
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
        "/api/v1/runtime/preview/format",
        json={
            "events": [{"event_id": "evt-1", "message": "hello"}],
            "destination_type": "SYSLOG_UDP",
            "formatter_config": {
                "message_format": "json",
                "syslog": {
                    "hostname": "gdc",
                    "app_name": "generic-connector",
                    "tag": "acme_edr",
                },
            },
        },
    )

    assert response.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0
