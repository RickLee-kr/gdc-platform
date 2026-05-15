from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.sources.adapters.s3_object_polling import S3ObjectPollingAdapter, parse_s3_object_records
from app.sources.models import Source
from app.streams.models import Stream


class _AllowAllLimiter:
    def allow(self, *_a: Any, **_k: Any) -> bool:
        return True


class _FakeWebhookSender:
    def __init__(self, fail_urls: set[str] | None = None) -> None:
        self.fail_urls = fail_urls or set()

    def send(
        self,
        events: list[dict[str, Any]],
        config: dict[str, Any],
        formatter_override: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        if str(config.get("url") or "") in self.fail_urls:
            raise RuntimeError("webhook send failed")


def _seed_s3_stream(
    db: Session,
    *,
    failure_policy: str = "LOG_AND_CONTINUE",
    webhook_url: str = "https://receiver-s3.example.com/hook",
) -> dict[str, Any]:
    connector = Connector(name="s3-e2e-connector", description="s3 runner", status="RUNNING")
    db.add(connector)
    db.flush()

    source = Source(
        connector_id=connector.id,
        source_type="S3_OBJECT_POLLING",
        config_json={
            "endpoint_url": "http://127.0.0.1:9000",
            "bucket": "b",
            "region": "us-east-1",
            "access_key": "k",
            "secret_key": "s",
            "prefix": "p/",
            "path_style_access": True,
            "use_ssl": False,
        },
        auth_json={"auth_type": "no_auth"},
        enabled=True,
    )
    db.add(source)
    db.flush()

    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="s3-e2e-stream",
        stream_type="S3_OBJECT_POLLING",
        config_json={"max_objects_per_run": 10},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 10, "per_seconds": 60},
    )
    db.add(stream)
    db.flush()

    mapping = Mapping(
        stream_id=stream.id,
        event_array_path=None,
        field_mappings_json={"event_id": "$.id", "message": "$.message", "severity": "$.severity"},
        raw_payload_mode="JSON",
    )
    enrichment = Enrichment(
        stream_id=stream.id,
        enrichment_json={"vendor": "S3Test"},
        override_policy="KEEP_EXISTING",
        enabled=True,
    )
    db.add_all([mapping, enrichment])
    db.flush()

    destination = Destination(
        name="s3-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": webhook_url},
        rate_limit_json={"max_events": 100, "per_seconds": 1},
        enabled=True,
    )
    db.add(destination)
    db.flush()

    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy=failure_policy,
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.flush()

    checkpoint = Checkpoint(
        stream_id=stream.id,
        checkpoint_type="CUSTOM_FIELD",
        checkpoint_value_json={"last_cursor": None},
    )
    db.add(checkpoint)
    db.commit()

    return {"stream_id": int(stream.id)}


def _checkpoint(db: Session, stream_id: int) -> dict[str, Any]:
    row = db.query(Checkpoint).filter(Checkpoint.stream_id == stream_id).first()
    assert row is not None
    return dict(row.checkpoint_value_json or {})


def test_s3_stream_runner_advances_checkpoint(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    seeded = _seed_s3_stream(db_session)
    sid = int(seeded["stream_id"])

    fetch_calls: list[dict[str, Any] | None] = []

    def _fake_fetch(
        self: S3ObjectPollingAdapter,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        fetch_calls.append(checkpoint)
        return [
            {
                "id": "e1",
                "message": "m1",
                "severity": "1",
                "s3_bucket": "b",
                "s3_key": "p/obj1.json",
                "s3_etag": "t1",
                "s3_last_modified": "2024-01-01T00:00:00Z",
                "s3_size": 10,
            },
            {
                "id": "e2",
                "message": "m2",
                "severity": "2",
                "s3_bucket": "b",
                "s3_key": "p/obj1.json",
                "s3_etag": "t1",
                "s3_last_modified": "2024-01-01T00:00:00Z",
                "s3_size": 10,
            },
        ]

    monkeypatch.setattr(S3ObjectPollingAdapter, "fetch", _fake_fetch)

    runner = StreamRunner(
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
    )
    ctx = load_stream_context(db_session, sid, require_enabled_stream=False)
    before = _checkpoint(db_session, sid)
    summary = runner.run(ctx, db=db_session)
    after = _checkpoint(db_session, sid)

    assert summary.get("checkpoint_updated") is True
    assert before.get("last_processed_key") is None
    assert after.get("last_processed_key") == "p/obj1.json"
    assert after.get("last_processed_last_modified") == "2024-01-01T00:00:00Z"
    assert isinstance(after.get("last_success_event"), dict)
    assert len(fetch_calls) == 1


def test_s3_stream_rerun_same_fetch_checkpoint_skips(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    seeded = _seed_s3_stream(db_session)
    sid = int(seeded["stream_id"])

    def _fake_fetch(
        self: S3ObjectPollingAdapter,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        lm = (checkpoint or {}).get("last_processed_last_modified")
        key = (checkpoint or {}).get("last_processed_key")
        if key == "p/obj1.json" and lm:
            return []
        return [
            {
                "id": "e1",
                "message": "m1",
                "severity": "1",
                "s3_bucket": "b",
                "s3_key": "p/obj1.json",
                "s3_etag": "t1",
                "s3_last_modified": "2024-01-01T00:00:00Z",
                "s3_size": 10,
            }
        ]

    monkeypatch.setattr(S3ObjectPollingAdapter, "fetch", _fake_fetch)
    runner = StreamRunner(
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
    )
    ctx = load_stream_context(db_session, sid, require_enabled_stream=False)
    runner.run(ctx, db=db_session)
    cp_mid = _checkpoint(db_session, sid)
    ctx2 = load_stream_context(db_session, sid, require_enabled_stream=False)
    summary2 = runner.run(ctx2, db=db_session)
    cp_end = _checkpoint(db_session, sid)

    assert cp_mid.get("last_processed_key") == "p/obj1.json"
    assert summary2.get("outcome") == "no_events"
    assert cp_end == cp_mid


def test_s3_stream_destination_failure_no_checkpoint_advance(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    url = "https://receiver-s3-fail.example.com/hook"
    seeded = _seed_s3_stream(db_session, failure_policy="PAUSE_STREAM_ON_FAILURE", webhook_url=url)
    sid = int(seeded["stream_id"])

    def _fake_fetch(
        self: S3ObjectPollingAdapter,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        return [
            {
                "id": "e1",
                "message": "m1",
                "severity": "1",
                "s3_bucket": "b",
                "s3_key": "p/obj1.json",
                "s3_etag": "t1",
                "s3_last_modified": "2024-01-01T00:00:00Z",
                "s3_size": 10,
            }
        ]

    monkeypatch.setattr(S3ObjectPollingAdapter, "fetch", _fake_fetch)
    runner = StreamRunner(
        source_limiter=_AllowAllLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(fail_urls={url}),
    )
    ctx = load_stream_context(db_session, sid, require_enabled_stream=False)
    before = _checkpoint(db_session, sid)
    summary = runner.run(ctx, db=db_session)
    after = _checkpoint(db_session, sid)

    assert summary.get("checkpoint_updated") is False
    assert after == before


@pytest.mark.minio
def test_minio_list_and_parse_integration() -> None:
    import os

    if not os.getenv("MINIO_ACCESS_KEY") or not os.getenv("MINIO_SECRET_KEY"):
        pytest.skip("MINIO_ACCESS_KEY/MINIO_SECRET_KEY not set")

    import boto3
    from botocore.client import Config

    endpoint = os.getenv("MINIO_ENDPOINT", "http://127.0.0.1:9000").rstrip("/")
    bucket = os.getenv("MINIO_BUCKET", "gdc-test-logs")
    ak = os.environ["MINIO_ACCESS_KEY"]
    sk = os.environ["MINIO_SECRET_KEY"]
    use_ssl = endpoint.lower().startswith("https://")

    session = boto3.session.Session(aws_access_key_id=ak, aws_secret_access_key=sk, region_name="us-east-1")
    client = session.client(
        "s3",
        endpoint_url=endpoint,
        use_ssl=use_ssl,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    resp = client.list_objects_v2(Bucket=bucket, Prefix="security/")
    keys = [str(o["Key"]) for o in (resp.get("Contents") or [])]
    assert any("events-001" in k for k in keys), f"expected seeded security NDJSON in bucket, got {keys!r}"

    obj = client.get_object(Bucket=bucket, Key="security/events-002.json")
    body = obj["Body"].read()
    rows = parse_s3_object_records(body, object_key="security/events-002.json")
    assert len(rows) >= 1 and rows[0].get("id")

    adapter = S3ObjectPollingAdapter()
    events = adapter.fetch(
        {
            "endpoint_url": endpoint,
            "bucket": bucket,
            "region": "us-east-1",
            "access_key": ak,
            "secret_key": sk,
            "prefix": "security/",
            "path_style_access": True,
            "use_ssl": use_ssl,
        },
        {"max_objects_per_run": 20},
        None,
    )
    assert isinstance(events, list) and len(events) >= 1
    assert all(isinstance(e, dict) and e.get("s3_key") for e in events)
