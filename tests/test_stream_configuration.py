"""Stream configuration, sample data, incremental test, replay, checkpoint, dedup APIs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.repository import upsert_checkpoint
from tests.test_stream_runner_e2e import _seed_stream_runtime


def test_stream_configuration_sections(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res.status_code == 200
    body = res.json()
    assert body["stream_id"] == stream_id
    titles = [s["title"] for s in body["sections"]]
    assert "Stream" in titles
    assert "Request" in titles
    assert "Deduplication" in titles
    assert "Incremental Fetch" in titles

    request_section = next(s for s in body["sections"] if s["title"] == "Request")
    method_field = next(f for f in request_section["fields"] if f["label"] == "HTTP Method")
    assert method_field["configured"] is True


def test_stream_configuration_not_configured_fields(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res.status_code == 200
    dedup_section = next(s for s in res.json()["sections"] if s["title"] == "Deduplication")
    enabled = next(f for f in dedup_section["fields"] if f["label"] == "Enabled")
    assert enabled["value"] in ("No", "Not configured")


def test_stream_sample_data_round_trip(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    empty = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sample-data")
    assert empty.status_code == 200
    assert empty.json()["has_sample_data"] is False

    payload = {
        "sample_events": [{"id": "evt-1", "message": "hello"}],
        "union_schema": {
            "total_events": 1,
            "fields": [
                {
                    "field_path": "$.id",
                    "field_type": "string",
                    "occurrence_count": 1,
                    "sample_values": ["evt-1"],
                }
            ],
        },
        "event_root_path": "$.data",
        "record_path": "$.data.items",
        "last_test_response": {"http_status": 200, "body_preview": "{}"},
    }
    save = runtime_api_client.put(f"/api/v1/runtime/streams/{stream_id}/sample-data", json=payload)
    assert save.status_code == 200
    saved = save.json()
    assert saved["has_sample_data"] is True
    assert saved["sample_count"] == 1
    assert saved["event_root_path"] == "$.data"

    reloaded = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sample-data")
    assert reloaded.status_code == 200
    body = reloaded.json()
    assert body["has_sample_data"] is True
    assert body["sample_count"] == 1
    assert body["event_root_path"] == "$.data"
    assert body["record_path"] == "$.data.items"


def test_stream_deduplication_save_and_load(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    payload = {
        "enabled": True,
        "key_field": "event_id",
        "custom_jsonpath": "$.id",
        "duplicate_handling": "keep_latest",
        "scope": "last_n_hours",
        "window_hours": 6,
    }
    put = runtime_api_client.put(f"/api/v1/runtime/streams/{stream_id}/deduplication", json=payload)
    assert put.status_code == 200
    assert put.json()["enabled"] is True
    assert put.json()["duplicate_handling"] == "keep_latest"

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/deduplication")
    assert get.status_code == 200
    body = get.json()
    assert body["scope"] == "last_n_hours"
    assert body["last_runtime_duplicate_count"] == 0
    assert body["last_runtime_dedup_summary"] is None
    assert body["last_runtime_stats_degraded"] is False

    from app.logs.models import DeliveryLog

    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage="dedup_queue_insert",
            level="INFO",
            message="dedup stats",
            payload_sample={
                "total_events": 7,
                "inserted": 5,
                "duplicate_events": 2,
                "duplicate_handling": "keep_latest",
                "dedup_scope": "last_n_hours",
            },
        )
    )
    db_session.commit()

    get2 = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/deduplication")
    assert get2.status_code == 200
    body2 = get2.json()
    assert body2["last_runtime_duplicate_count"] == 2
    assert body2["last_runtime_stats_degraded"] is False
    summary = body2["last_runtime_dedup_summary"]
    assert isinstance(summary, dict)
    assert summary["total_events"] == 7
    assert summary["inserted"] == 5
    assert summary["duplicate_events"] == 2
    assert summary["duplicate_handling"] == "keep_latest"
    assert summary["dedup_scope"] == "last_n_hours"
    assert summary.get("recorded_at")


def test_stream_checkpoint_manage_and_reset(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="cursor",
        checkpoint_value_json={"last_success_event": {"id": "abc-1"}},
    )
    db_session.commit()

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert get.status_code == 200
    body = get.json()
    assert body["checkpoint_type"] == "cursor"
    assert body["checkpoint_mode"] == "legacy"
    assert body["legacy_checkpoint"] is not None

    update = runtime_api_client.put(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint",
        json={"checkpoint_type": "manual_edit", "checkpoint_value": {"last_success_event": {"id": "xyz-9"}}},
    )
    assert update.status_code == 200
    assert update.json()["checkpoint_value"]["last_success_event"]["id"] == "xyz-9"

    reloaded = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert reloaded.status_code == 200
    assert reloaded.json()["checkpoint_value"]["last_success_event"]["id"] == "xyz-9"

    reset = runtime_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint/reset",
        json={"reason": "test reset"},
    )
    assert reset.status_code == 200
    assert reset.json()["checkpoint_type"] is None

    after_reset = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert after_reset.status_code == 200
    assert after_reset.json()["checkpoint_type"] is None
    assert after_reset.json()["checkpoint_value"] is None


def test_stream_incremental_fetch_save_and_load(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    payload = {
        "strategy": "closed_window_watermark",
        "watermark_field": "$.ts",
        "tie_breaker_field": "$.id",
        "stability_lag_seconds": 90,
        "initial_lookback_seconds": 7200,
    }
    put = runtime_api_client.put(f"/api/v1/runtime/streams/{stream_id}/incremental-fetch", json=payload)
    assert put.status_code == 200
    assert put.json()["strategy"] == "closed_window_watermark"
    assert put.json()["stability_lag_seconds"] == 90

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/incremental-fetch")
    assert get.status_code == 200
    body = get.json()
    assert body["framework_enabled"] is True
    assert body["watermark_field"] == "$.ts"


def test_stream_incremental_test_does_not_change_checkpoint(
    runtime_api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    before = {"last_success_event": {"id": "keep-me"}}
    upsert_checkpoint(db_session, stream_id=stream_id, checkpoint_type="cursor", checkpoint_value_json=before)
    db_session.commit()

    from app.runtime.schemas import HttpApiTestAnalysis, HttpApiTestResponse, HttpApiTestResponseMeta

    def _fake_test(*_args, **_kwargs):
        return HttpApiTestResponse(
            ok=True,
            request={"method": "GET", "url": "http://example.test", "headers_masked": {}},
            response=HttpApiTestResponseMeta(
                status_code=200,
                latency_ms=10,
                headers={},
                raw_body='{"items":[{"id":"1"}]}',
                parsed_json={"items": [{"id": "1"}]},
            ),
            analysis=HttpApiTestAnalysis(
                response_summary={"root_type": "object", "approx_size_bytes": 10, "top_level_keys": ["items"]},
                sample_event={"id": "1"},
            ),
        )

    monkeypatch.setattr("app.runtime.stream_configuration_service.run_http_api_test", _fake_test)

    res = runtime_api_client.post(f"/api/v1/runtime/streams/{stream_id}/incremental-test", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["checkpoint_unchanged"] is True
    assert body["ok"] is True

    after = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert after.json()["checkpoint_value"]["last_success_event"]["id"] == "keep-me"


def test_stream_checkpoint_framework_split(runtime_api_client: TestClient, db_session: Session) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    from app.streams.models import Stream

    row = db_session.query(Stream).filter(Stream.id == stream_id).one()
    cfg = dict(row.config_json or {})
    cfg["incremental_fetch"] = {"strategy": "timestamp_watermark", "watermark_field": "$.ts"}
    row.config_json = cfg
    db_session.add(row)
    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="timestamp",
        checkpoint_value_json={
            "incremental_fetch_watermark": "2026-01-01T00:00:00Z",
            "delivery_checkpoint": {"last_success_event": {"id": "evt-1"}},
        },
    )
    db_session.commit()

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert res.status_code == 200
    body = res.json()
    assert body["framework_enabled"] is True
    assert body["checkpoint_mode"] == "framework"
    assert body["fetch_checkpoint"]["incremental_fetch_watermark"] == "2026-01-01T00:00:00Z"
    assert body["delivery_checkpoint"]["last_success_event"]["id"] == "evt-1"


def test_checkpoint_activity_degrades_on_statement_timeout(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError
    from unittest.mock import MagicMock

    from app.runtime import stream_configuration_service as svc

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])

    def _boom(*_args, **_kwargs):
        q = MagicMock()
        q.filter.return_value.scalar.side_effect = OperationalError(
            "SELECT 1",
            {},
            Exception("canceling statement due to statement timeout"),
        )
        return q

    monkeypatch.setattr(db_session, "query", _boom)
    activity = svc._checkpoint_activity(db_session, stream_id)
    assert activity == {
        "last_success_at": None,
        "last_failure_at": None,
        "last_collected_event_at": None,
    }


def test_stream_checkpoint_api_returns_200_when_activity_times_out(
    runtime_api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError
    from unittest.mock import MagicMock

    from app.runtime import stream_configuration_service as svc

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="cursor",
        checkpoint_value_json={"last_success_event": {"id": "keep-on-timeout"}},
    )
    db_session.commit()

    real_activity = svc._checkpoint_activity

    def _timeout_activity(db: Session, sid: int):
        def _boom(*_args, **_kwargs):
            q = MagicMock()
            q.filter.return_value.scalar.side_effect = OperationalError(
                "SELECT 1",
                {},
                Exception("canceling statement due to statement timeout"),
            )
            return q

        monkeypatch.setattr(db, "query", _boom)
        return real_activity(db, sid)

    monkeypatch.setattr(svc, "_checkpoint_activity", _timeout_activity)

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert res.status_code == 200
    body = res.json()
    assert body["checkpoint_type"] == "cursor"
    assert body["checkpoint_value"]["last_success_event"]["id"] == "keep-on-timeout"
    assert body["last_success_at"] is None
    assert body["last_failure_at"] is None
    assert body["last_collected_event_at"] is None
    assert svc._CHECKPOINT_ACTIVITY_STATEMENT_TIMEOUT_MS == 5000
    assert svc._CHECKPOINT_ACTIVITY_LOOKBACK == timedelta(hours=24)

def test_checkpoint_activity_respects_created_at_lookback(db_session: Session) -> None:
    from app.logs.models import DeliveryLog
    from app.runtime import stream_configuration_service as svc

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    old = datetime.now(timezone.utc) - timedelta(hours=48)
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage="route_send_success",
            level="INFO",
            status="OK",
            message="old success",
            created_at=old,
        )
    )
    db_session.commit()

    activity = svc._checkpoint_activity(db_session, stream_id)
    assert activity["last_success_at"] is None

    recent = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.add(
        DeliveryLog(
            stream_id=stream_id,
            stage="route_send_success",
            level="INFO",
            status="OK",
            message="recent success",
            created_at=recent,
        )
    )
    db_session.commit()
    activity2 = svc._checkpoint_activity(db_session, stream_id)
    assert activity2["last_success_at"] is not None


def test_stream_replay_dry_run_time_range(
    runtime_api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    now = datetime.now(timezone.utc)

    class _Job:
        id = 99
        status = "COMPLETED"
        error_summary = None
        delivery_summary_json = {"event_count": 3}

    captured: dict[str, object] = {}

    def _capture(_db, payload):
        captured["apply_dedup"] = getattr(payload, "apply_dedup", None)
        captured["dry_run"] = getattr(payload, "dry_run", None)
        return _Job()

    monkeypatch.setattr(
        "app.runtime.stream_configuration_service.backfill_service.replay_stream_backfill",
        _capture,
    )

    res = runtime_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/replay",
        json={
            "mode": "time_range",
            "dry_run": True,
            "start_time": (now - timedelta(hours=1)).isoformat(),
            "end_time": now.isoformat(),
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["dry_run"] is True
    assert body["apply_dedup"] is True
    assert body["checkpoint_unchanged"] is True
    assert body["backfill_job_id"] == 99
    assert captured["apply_dedup"] is True
    assert captured["dry_run"] is True


def test_stream_replay_apply_dedup_false_passed_through(
    runtime_api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    now = datetime.now(timezone.utc)

    class _Job:
        id = 100
        status = "COMPLETED"
        error_summary = None
        delivery_summary_json = {"event_count": 2}

    captured: dict[str, object] = {}

    def _capture(_db, payload):
        captured["apply_dedup"] = getattr(payload, "apply_dedup", None)
        return _Job()

    monkeypatch.setattr(
        "app.runtime.stream_configuration_service.backfill_service.replay_stream_backfill",
        _capture,
    )

    res = runtime_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/replay",
        json={
            "mode": "time_range",
            "dry_run": False,
            "apply_dedup": False,
            "start_time": (now - timedelta(hours=1)).isoformat(),
            "end_time": now.isoformat(),
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["dry_run"] is False
    assert body["apply_dedup"] is False
    assert captured["apply_dedup"] is False

def _fresh_session(db_engine):
    from sqlalchemy.orm import sessionmaker

    return sessionmaker(bind=db_engine, autocommit=False, autoflush=False)()


def test_stream_incremental_fetch_put_persists_across_sessions(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    db_session.commit()

    payload = {
        "strategy": "closed_window_watermark",
        "watermark_field": "$.persist_ts",
        "tie_breaker_field": "$.persist_id",
        "stability_lag_seconds": 42,
        "initial_lookback_seconds": 3600,
    }
    put = runtime_api_client.put(f"/api/v1/runtime/streams/{stream_id}/incremental-fetch", json=payload)
    assert put.status_code == 200

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/incremental-fetch")
    assert get.status_code == 200
    assert get.json()["watermark_field"] == "$.persist_ts"
    assert get.json()["stability_lag_seconds"] == 42

    from app.streams.models import Stream

    fresh = _fresh_session(db_engine)
    try:
        row = fresh.get(Stream, stream_id)
        assert row is not None
        inc = (row.config_json or {}).get("incremental_fetch") or {}
        assert inc["watermark_field"] == "$.persist_ts"
        assert inc["stability_lag_seconds"] == 42
    finally:
        fresh.close()


def test_stream_sample_data_put_persists_across_sessions(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    db_session.commit()

    payload = {
        "sample_events": [{"id": "persist-1"}],
        "event_root_path": "$.persist.root",
        "record_path": "$.persist.items",
    }
    put = runtime_api_client.put(f"/api/v1/runtime/streams/{stream_id}/sample-data", json=payload)
    assert put.status_code == 200

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/sample-data")
    assert get.status_code == 200
    assert get.json()["event_root_path"] == "$.persist.root"
    assert get.json()["sample_count"] == 1

    from app.streams.models import Stream

    fresh = _fresh_session(db_engine)
    try:
        row = fresh.get(Stream, stream_id)
        assert row is not None
        sample = (row.config_json or {}).get("wizard_sample_data") or {}
        assert sample["event_root_path"] == "$.persist.root"
        assert sample["sample_count"] == 1
    finally:
        fresh.close()


def test_stream_checkpoint_put_persists_across_sessions(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="cursor",
        checkpoint_value_json={"last_success_event": {"id": "before"}},
    )
    db_session.commit()

    put = runtime_api_client.put(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint",
        json={
            "checkpoint_type": "manual_edit",
            "checkpoint_value": {"last_success_event": {"id": "after-persist"}},
        },
    )
    assert put.status_code == 200

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert get.status_code == 200
    assert get.json()["checkpoint_value"]["last_success_event"]["id"] == "after-persist"

    from app.checkpoints.models import Checkpoint

    fresh = _fresh_session(db_engine)
    try:
        row = fresh.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
        assert row.checkpoint_type == "manual_edit"
        assert row.checkpoint_value_json["last_success_event"]["id"] == "after-persist"
    finally:
        fresh.close()


def test_stream_configuration_puts_rollback_on_error(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Flush-then-raise must not leave partial writes visible to a new DB session."""

    import app.runtime.stream_configuration_service as svc

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    db_session.commit()

    real_inc = svc.save_stream_incremental_fetch
    real_sample = svc.save_stream_sample_data
    real_ckpt = svc.update_stream_checkpoint

    def _boom_inc(db, sid, payload):
        real_inc(db, sid, payload)
        raise ValueError("forced incremental-fetch failure")

    def _boom_sample(db, sid, payload):
        real_sample(db, sid, payload)
        raise ValueError("forced sample-data failure")

    def _boom_ckpt(db, sid, payload):
        real_ckpt(db, sid, payload)
        raise ValueError("forced checkpoint failure")

    monkeypatch.setattr(svc, "save_stream_incremental_fetch", _boom_inc)
    fail_inc = runtime_api_client.put(
        f"/api/v1/runtime/streams/{stream_id}/incremental-fetch",
        json={
            "strategy": "closed_window_watermark",
            "watermark_field": "$.should_not_persist",
            "stability_lag_seconds": 1,
            "initial_lookback_seconds": 1,
        },
    )
    assert fail_inc.status_code == 422
    monkeypatch.setattr(svc, "save_stream_incremental_fetch", real_inc)

    monkeypatch.setattr(svc, "save_stream_sample_data", _boom_sample)
    fail_sample = runtime_api_client.put(
        f"/api/v1/runtime/streams/{stream_id}/sample-data",
        json={"sample_events": [{"id": "should-not-persist"}], "event_root_path": "$.nope"},
    )
    assert fail_sample.status_code == 422
    monkeypatch.setattr(svc, "save_stream_sample_data", real_sample)

    monkeypatch.setattr(svc, "update_stream_checkpoint", _boom_ckpt)
    fail_ckpt = runtime_api_client.put(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint",
        json={"checkpoint_type": "manual_edit", "checkpoint_value": {"last_success_event": {"id": "nope"}}},
    )
    assert fail_ckpt.status_code == 422
    monkeypatch.setattr(svc, "update_stream_checkpoint", real_ckpt)

    # Shared test session may still hold uncommitted state; rollback then verify via fresh session.
    db_session.rollback()

    from app.checkpoints.models import Checkpoint
    from app.streams.models import Stream

    fresh = _fresh_session(db_engine)
    try:
        stream = fresh.get(Stream, stream_id)
        assert stream is not None
        cfg = stream.config_json or {}
        assert (cfg.get("incremental_fetch") or {}).get("watermark_field") != "$.should_not_persist"
        sample = cfg.get("wizard_sample_data") or {}
        assert sample.get("event_root_path") != "$.nope"
        ckpt = fresh.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one_or_none()
        if ckpt is not None:
            assert (ckpt.checkpoint_value_json or {}).get("last_success_event", {}).get("id") != "nope"
    finally:
        fresh.close()


def test_stream_checkpoint_reset_persists_across_sessions(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="cursor",
        checkpoint_value_json={"last_success_event": {"id": "reset-me"}},
    )
    db_session.commit()

    before = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert before.status_code == 200
    assert before.json()["checkpoint_value"]["last_success_event"]["id"] == "reset-me"

    reset = runtime_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint/reset",
        json={"reason": "persist reset"},
    )
    assert reset.status_code == 200
    assert reset.json()["checkpoint_type"] is None

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert get.status_code == 200
    assert get.json()["checkpoint_type"] is None
    assert get.json()["checkpoint_value"] is None

    from app.checkpoints.models import Checkpoint

    fresh = _fresh_session(db_engine)
    try:
        row = fresh.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one_or_none()
        assert row is None
    finally:
        fresh.close()


def test_stream_checkpoint_reset_rollback_on_error(
    runtime_api_client: TestClient,
    db_session: Session,
    db_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Flush-then-raise on reset must preserve the existing checkpoint row."""

    import app.runtime.stream_configuration_service as svc

    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    upsert_checkpoint(
        db_session,
        stream_id=stream_id,
        checkpoint_type="cursor",
        checkpoint_value_json={"last_success_event": {"id": "keep-on-rollback"}},
    )
    db_session.commit()

    real_reset = svc.reset_stream_checkpoint

    def _boom(db, sid, payload):
        real_reset(db, sid, payload)
        raise ValueError("forced checkpoint reset failure")

    monkeypatch.setattr(svc, "reset_stream_checkpoint", _boom)
    fail = runtime_api_client.post(
        f"/api/v1/runtime/streams/{stream_id}/checkpoint/reset",
        json={"reason": "should roll back"},
    )
    assert fail.status_code == 422
    monkeypatch.setattr(svc, "reset_stream_checkpoint", real_reset)

    db_session.rollback()

    from app.checkpoints.models import Checkpoint

    fresh = _fresh_session(db_engine)
    try:
        row = fresh.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).one()
        assert row.checkpoint_type == "cursor"
        assert row.checkpoint_value_json["last_success_event"]["id"] == "keep-on-rollback"
    finally:
        fresh.close()

    get = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/checkpoint")
    assert get.status_code == 200
    assert get.json()["checkpoint_value"]["last_success_event"]["id"] == "keep-on-rollback"
