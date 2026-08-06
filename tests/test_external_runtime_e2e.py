"""External-service runtime E2E: StreamRunner pipeline against real MinIO, PostgreSQL, SFTP, WireMock.

Run: ./scripts/test/run-external-runtime-e2e-tests.sh
     python3 -m pytest -m e2e_runtime tests/test_external_runtime_e2e.py -v

Requires docker-compose.test.yml fixtures (see docs/testing/external-runtime-e2e.md).
Does not bypass StreamRunner or use mock-only delivery shortcuts for pipeline assertions.
"""

from __future__ import annotations

import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.logs.models import DeliveryLog
from app.main import app
from app.templates.registry import clear_template_cache
from tests.e2e_runtime_helpers import (
    WIREMOCK_BASE,
    assert_observability_after_success,
    checkpoint_snapshot,
    create_db_query_connector_and_stream,
    create_remote_file_connector_and_stream,
    create_s3_connector_and_stream,
    create_webhook_receiver_stack,
    delivery_log_stages,
    ensure_checkpoint,
    insert_pg_fixture_rows,
    reset_pg_fixture_seed,
    minio_reachable,
    pg_fixture_reachable,
    post_webhook_ingest,
    prepare_wiremock_run,
    put_minio_object,
    run_once,
    save_mapping_enrichment,
    seed_isolated_s3_objects,
    sftp_reachable,
    upload_sftp_file,
    wait_for_delivery_log_stage,
    wiremock_ok,
    wiremock_received_json_bodies,
    wiremock_route,
)
from tests.e2e_wiremock_helpers import (
    assert_run_observability_core,
    enable_stream_for_run,
    ensure_source_e2e_webhook_stub,
    ensure_template_wiremock_mappings,
    reset_wiremock_journal,
)

pytestmark = [pytest.mark.e2e_runtime, pytest.mark.e2e_external]

skip_no_wiremock = pytest.mark.skipif(not wiremock_ok(), reason=f"WireMock not reachable at {WIREMOCK_BASE}")
skip_no_minio = pytest.mark.skipif(not minio_reachable(), reason="MinIO fixture port not open")
skip_no_pg = pytest.mark.skipif(not pg_fixture_reachable(), reason="postgres-query-test port not open")
skip_no_sftp = pytest.mark.skipif(not sftp_reachable(), reason="sftp-test port not open")

_DB_QUERY = {
    "query": "SELECT id, event_id, message, severity, event_ts, ordering_seq FROM source_e2e_rows ORDER BY event_ts, ordering_seq, id",
    "max_rows_per_run": 50,
    "checkpoint_mode": "COMPOSITE_ORDER",
    "checkpoint_column": "event_ts",
    "checkpoint_order_column": "ordering_seq",
    "query_timeout_seconds": 30,
}


@pytest.fixture
def client(db_session: Session) -> TestClient:
    clear_template_cache()

    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        clear_template_cache()


# --- PostgreSQL DATABASE_QUERY ---


@skip_no_wiremock
@skip_no_pg
@pytest.mark.e2e_runtime
def test_database_query_initial_incremental_and_noop_poll(
    client: TestClient, db_session: Session
) -> None:
    reset_pg_fixture_seed()
    suffix = uuid.uuid4().hex[:8]
    _, _, stream_id = create_db_query_connector_and_stream(
        client, name_suffix=suffix, stream_config=dict(_DB_QUERY)
    )
    save_mapping_enrichment(client, stream_id)
    prepare_wiremock_run(client, stream_id, f"/source-e2e/ext-db-init-{suffix}")
    ensure_checkpoint(db_session, stream_id)

    r1 = run_once(client, stream_id)
    assert r1.get("checkpoint_updated") is True
    assert int(r1.get("extracted_event_count") or 0) == 3
    cp_after_first = checkpoint_snapshot(db_session, stream_id)
    assert cp_after_first.get("last_processed_event_ts") or cp_after_first.get("last_success_event")

    r2 = run_once(client, stream_id)
    assert r2.get("outcome") == "no_events"
    assert r2.get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == cp_after_first


@skip_no_wiremock
@skip_no_pg
@pytest.mark.e2e_runtime
def test_database_query_second_batch_after_insert(
    client: TestClient, db_session: Session
) -> None:
    reset_pg_fixture_seed()
    suffix = uuid.uuid4().hex[:8]
    _, _, stream_id = create_db_query_connector_and_stream(
        client, name_suffix=suffix, stream_config=dict(_DB_QUERY)
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/ext-db-batch-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)

    run_once(client, stream_id)
    cp_before_insert = checkpoint_snapshot(db_session, stream_id)
    insert_pg_fixture_rows(
        [("e2e-db-new-1", "incremental row", "high", "2020-01-02T00:00:00Z", 1)]
    )

    r2 = run_once(client, stream_id)
    assert r2.get("checkpoint_updated") is True
    assert int(r2.get("extracted_event_count") or 0) == 1
    assert checkpoint_snapshot(db_session, stream_id) != cp_before_insert

    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "incremental row" for b in bodies)


@skip_no_wiremock
@skip_no_pg
@pytest.mark.e2e_runtime
def test_database_query_destination_failure_preserves_checkpoint(
    client: TestClient, db_session: Session
) -> None:
    reset_pg_fixture_seed()
    suffix = uuid.uuid4().hex[:8]
    _, _, stream_id = create_db_query_connector_and_stream(
        client, name_suffix=suffix, stream_config=dict(_DB_QUERY)
    )
    save_mapping_enrichment(client, stream_id)
    dest_bad = client.post(
        "/api/v1/destinations/",
        json={
            "name": f"e2e-db-bad-{suffix}",
            "destination_type": "WEBHOOK_POST",
            "config_json": {
                "url": "http://127.0.0.1:1/unreachable",
                "retry_count": 0,
                "retry_backoff_seconds": 0.01,
            },
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest_bad.status_code == 201, dest_bad.text
    client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream_id,
            "destination_id": int(dest_bad.json()["id"]),
            "failure_policy": "PAUSE_STREAM_ON_FAILURE",
        },
    )
    ensure_checkpoint(db_session, stream_id)
    ck_before = checkpoint_snapshot(db_session, stream_id)
    enable_stream_for_run(client, stream_id)

    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 200, run.text
    assert run.json().get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == ck_before
    assert "route_send_failed" in delivery_log_stages(db_session, stream_id)


# --- S3_OBJECT_POLLING (MinIO) ---


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_runtime
def test_s3_listing_checkpoint_and_object_key_pattern_filter(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    put_minio_object(
        f"e2e-runtime/{suffix}/only.ndjson",
        b'{"id":"pat-1","message":"pattern ndjson","severity":"low"}\n',
    )
    put_minio_object(
        f"e2e-runtime/{suffix}/skip.json",
        b'{"id":"pat-skip","message":"filtered out","severity":"low"}',
    )
    _, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=suffix,
        prefix=f"e2e-runtime/{suffix}/",
        stream_config={"max_objects_per_run": 10},
        source_extras={"object_key_pattern": "*.ndjson"},
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/ext-s3-pattern-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)

    run = run_once(client, stream_id)
    assert run.get("checkpoint_updated") is True
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    msgs = {str(b.get("message") or "") for b in bodies}
    assert "pattern ndjson" in msgs
    assert "filtered out" not in msgs

    cp = checkpoint_snapshot(db_session, stream_id)
    assert cp.get("last_processed_key")


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_runtime
def test_s3_already_processed_object_skipped_on_second_run(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    prefix = seed_isolated_s3_objects(
        suffix,
        {
            "once.ndjson": b'{"id":"dup-1","message":"process once","severity":"info"}\n',
        },
    )
    _, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=suffix,
        prefix=prefix,
        stream_config={"max_objects_per_run": 20},
    )
    save_mapping_enrichment(client, stream_id)
    prepare_wiremock_run(client, stream_id, f"/source-e2e/ext-s3-dup-{suffix}")
    ensure_checkpoint(db_session, stream_id)

    r1 = run_once(client, stream_id)
    assert r1.get("checkpoint_updated") is True
    cp1 = checkpoint_snapshot(db_session, stream_id)

    r2 = run_once(client, stream_id)
    assert r2.get("outcome") == "no_events"
    assert r2.get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == cp1


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_runtime
def test_s3_new_object_arrival_delivers(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    key = f"e2e-runtime/{suffix}/dynamic.ndjson"
    put_minio_object(
        key,
        b'{"id":"dyn-1","message":"dynamic object","severity":"info"}\n',
    )
    _, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=suffix,
        prefix=f"e2e-runtime/{suffix}/",
        stream_config={"max_objects_per_run": 5},
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/ext-s3-new-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)

    run_once(client, stream_id)
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "dynamic object" for b in bodies)


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_runtime
def test_s3_destination_failure_no_checkpoint(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    prefix = seed_isolated_s3_objects(
        suffix,
        {"fail.ndjson": b'{"id":"fail-1","message":"dest fail","severity":"info"}\n'},
    )
    _, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=suffix,
        prefix=prefix,
        stream_config={"max_objects_per_run": 5},
    )
    save_mapping_enrichment(client, stream_id)
    dest_bad = client.post(
        "/api/v1/destinations/",
        json={
            "name": f"e2e-s3-bad-{suffix}",
            "destination_type": "WEBHOOK_POST",
            "config_json": {"url": "http://127.0.0.1:1/nope", "retry_count": 0},
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest_bad.status_code == 201
    client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream_id,
            "destination_id": int(dest_bad.json()["id"]),
            "failure_policy": "PAUSE_STREAM_ON_FAILURE",
        },
    )
    ensure_checkpoint(db_session, stream_id)
    ck_before = checkpoint_snapshot(db_session, stream_id)
    enable_stream_for_run(client, stream_id)

    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 200
    assert run.json().get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == ck_before


# --- REMOTE_FILE_POLLING (SFTP) ---


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
@pytest.mark.e2e_runtime
def test_remote_file_new_file_and_checkpoint_metadata(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    upload_sftp_file(
        "e2e-remote.ndjson",
        b'{"id":"rf-new-1","message":"new remote file","severity":"info"}\n',
    )
    _, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=suffix,
        stream_config={
            "remote_directory": "upload",
            "file_pattern": "e2e-remote.ndjson",
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/ext-rf-new-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)

    run = run_once(client, stream_id)
    assert run.get("checkpoint_updated") is True
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "new remote file" for b in bodies)
    cp = checkpoint_snapshot(db_session, stream_id)
    assert cp.get("last_processed_hash") or cp.get("last_processed_file")


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
@pytest.mark.e2e_runtime
def test_remote_file_unchanged_skipped_second_run(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    upload_sftp_file(
        "e2e-remote.ndjson",
        b'{"id":"rf-static","message":"unchanged","severity":"low"}\n',
    )
    _, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=suffix,
        stream_config={
            "remote_directory": "upload",
            "file_pattern": "e2e-remote.ndjson",
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
    )
    save_mapping_enrichment(client, stream_id)
    prepare_wiremock_run(client, stream_id, f"/source-e2e/ext-rf-skip-{suffix}")
    ensure_checkpoint(db_session, stream_id)

    r1 = run_once(client, stream_id)
    assert r1.get("checkpoint_updated") is True
    cp1 = checkpoint_snapshot(db_session, stream_id)

    r2 = run_once(client, stream_id)
    assert r2.get("outcome") == "no_events"
    assert r2.get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == cp1


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
@pytest.mark.e2e_runtime
def test_remote_file_modified_content_redelivered(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    upload_sftp_file(
        "e2e-remote.ndjson",
        b'{"id":"rf-m1","message":"version one","severity":"low"}\n',
    )
    _, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=suffix,
        stream_config={
            "remote_directory": "upload",
            "file_pattern": "e2e-remote.ndjson",
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
    )
    save_mapping_enrichment(client, stream_id)
    wm_path = f"/source-e2e/ext-rf-mut-{suffix}"
    prepare_wiremock_run(client, stream_id, wm_path)
    ensure_checkpoint(db_session, stream_id)

    run_once(client, stream_id)
    upload_sftp_file(
        "e2e-remote.ndjson",
        b'{"id":"rf-m2","message":"version two","severity":"high"}\n',
    )

    r2 = run_once(client, stream_id)
    assert r2.get("checkpoint_updated") is True
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert any(str(b.get("message") or "") == "version two" for b in bodies)


@skip_no_wiremock
@skip_no_sftp
@pytest.mark.sftp
@pytest.mark.e2e_runtime
def test_remote_file_destination_failure_preserves_checkpoint(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    fail_pattern = f"e2e-remote-fail-{suffix}.ndjson"
    upload_sftp_file(
        fail_pattern,
        b'{"id":"rf-fail","message":"fail path","severity":"low"}\n',
    )
    _, _, stream_id = create_remote_file_connector_and_stream(
        client,
        name_suffix=suffix,
        stream_config={
            "remote_directory": "upload",
            "file_pattern": fail_pattern,
            "recursive": False,
            "parser_type": "NDJSON",
            "max_files_per_run": 5,
            "max_file_size_mb": 5,
        },
    )
    save_mapping_enrichment(client, stream_id)
    dest_bad = client.post(
        "/api/v1/destinations/",
        json={
            "name": f"e2e-rf-bad-{suffix}",
            "destination_type": "WEBHOOK_POST",
            "config_json": {"url": "http://127.0.0.1:1/nope", "retry_count": 0},
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    assert dest_bad.status_code == 201
    client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream_id,
            "destination_id": int(dest_bad.json()["id"]),
            "failure_policy": "PAUSE_STREAM_ON_FAILURE",
        },
    )
    ensure_checkpoint(db_session, stream_id)
    ck_before = checkpoint_snapshot(db_session, stream_id)
    enable_stream_for_run(client, stream_id)

    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 200
    assert run.json().get("checkpoint_updated") is False
    assert checkpoint_snapshot(db_session, stream_id) == ck_before


# --- WEBHOOK_RECEIVER (WireMock destinations) ---


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_json_object_delivery_logs_and_no_checkpoint(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-runtime-{suffix}"
    stack = create_webhook_receiver_stack(
        client,
        db_session,
        name_suffix=suffix,
        receiver_key=receiver_key,
    )
    stream_id = int(stack["stream_id"])
    wm_path = f"/source-e2e/ext-wh-obj-{suffix}"
    ensure_source_e2e_webhook_stub(WIREMOCK_BASE)
    reset_wiremock_journal(WIREMOCK_BASE)
    wiremock_route(client, stream_id, wm_path)

    ck_before = checkpoint_snapshot(db_session, stream_id)
    resp = post_webhook_ingest(
        client,
        receiver_key,
        json_body={"id": "wh-1", "message": "hello webhook"},
        headers={"X-GDC-Webhook-Secret": stack["shared_secret"]},
    )
    assert resp.status_code == 200, resp.text
    wait_for_delivery_log_stage(db_session, stream_id, "route_send_success")
    assert checkpoint_snapshot(db_session, stream_id) == ck_before
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert bodies and str(bodies[0].get("message") or "") == "hello webhook"
    assert "checkpoint_update" not in delivery_log_stages(db_session, stream_id)


@pytest.mark.parametrize(
    ("body", "content_type", "expected"),
    [
        (
            json.dumps([{"id": "arr-1", "message": "one"}, {"id": "arr-2", "message": "two"}]),
            "application/json",
            2,
        ),
        (
            '{"id":"nd-1","message":"one"}\n{"id":"nd-2","message":"two"}\n',
            "application/x-ndjson",
            2,
        ),
    ],
)
@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_json_array_and_ndjson_wiremock(
    client: TestClient,
    db_session: Session,
    body: str,
    content_type: str,
    expected: int,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-array-{suffix}"
    stack = create_webhook_receiver_stack(
        client, db_session, name_suffix=suffix, receiver_key=receiver_key
    )
    stream_id = int(stack["stream_id"])
    wm_path = f"/source-e2e/ext-wh-array-{suffix}"
    ensure_source_e2e_webhook_stub(WIREMOCK_BASE)
    reset_wiremock_journal(WIREMOCK_BASE)
    wiremock_route(client, stream_id, wm_path)

    resp = post_webhook_ingest(
        client,
        receiver_key,
        raw_content=body,
        headers={
            "Content-Type": content_type,
            "X-GDC-Webhook-Secret": stack["shared_secret"],
        },
    )
    assert resp.status_code == 200, resp.text
    wait_for_delivery_log_stage(db_session, stream_id, "run_complete")
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert len(bodies) == expected


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_multi_route_partial_failure_isolation(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-fanout-{suffix}"
    stack = create_webhook_receiver_stack(
        client, db_session, name_suffix=suffix, receiver_key=receiver_key
    )
    stream_id = int(stack["stream_id"])
    ensure_source_e2e_webhook_stub(WIREMOCK_BASE)
    ensure_template_wiremock_mappings(WIREMOCK_BASE)
    reset_wiremock_journal(WIREMOCK_BASE)
    wiremock_route(client, stream_id, f"/source-e2e/ext-wh-ok-{suffix}")
    wiremock_route(
        client,
        stream_id,
        "/wiremock-integration/receiver-fail",
        failure_policy="LOG_AND_CONTINUE",
        retry_count=0,
    )

    resp = post_webhook_ingest(
        client,
        receiver_key,
        json_body={"id": "fan-1", "message": "multi route"},
        headers={"X-GDC-Webhook-Secret": stack["shared_secret"]},
    )
    assert resp.status_code == 200, resp.text
    stages = delivery_log_stages(db_session, stream_id)
    assert "route_send_success" in stages
    assert "route_send_failed" in stages
    assert "run_complete" in stages


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_invalid_auth_rejected(client: TestClient, db_session: Session) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-badauth-{suffix}"
    stack = create_webhook_receiver_stack(
        client, db_session, name_suffix=suffix, receiver_key=receiver_key
    )
    stream_id = int(stack["stream_id"])
    log_n = db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == stream_id).count()

    resp = post_webhook_ingest(
        client,
        receiver_key,
        json_body={"id": "x", "message": "nope"},
        headers={"X-GDC-Webhook-Secret": "wrong-secret"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"]["error_code"] == "WEBHOOK_AUTH_FAILED"
    assert (
        db_session.query(DeliveryLog).filter(DeliveryLog.stream_id == stream_id).count() == log_n
    )


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_disabled_stream_rejected(client: TestClient, db_session: Session) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-disabled-{suffix}"
    stack = create_webhook_receiver_stack(
        client,
        db_session,
        name_suffix=suffix,
        receiver_key=receiver_key,
        enabled_stream=False,
    )
    resp = post_webhook_ingest(
        client,
        receiver_key,
        json_body={"id": "d1", "message": "blocked"},
        headers={"X-GDC-Webhook-Secret": stack["shared_secret"]},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "WEBHOOK_RECEIVER_DISABLED"


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_malformed_payload_rejected(client: TestClient, db_session: Session) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-badjson-{suffix}"
    stack = create_webhook_receiver_stack(
        client, db_session, name_suffix=suffix, receiver_key=receiver_key
    )
    resp = post_webhook_ingest(
        client,
        receiver_key,
        raw_content="{not-json",
        headers={
            "Content-Type": "application/json",
            "X-GDC-Webhook-Secret": stack["shared_secret"],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "WEBHOOK_INVALID_PAYLOAD"


@skip_no_wiremock
@pytest.mark.webhook
@pytest.mark.e2e_runtime
def test_webhook_concurrent_ingest_burst(client: TestClient, db_session: Session) -> None:
    suffix = uuid.uuid4().hex[:8]
    receiver_key = f"rx-burst-{suffix}"
    stack = create_webhook_receiver_stack(
        client, db_session, name_suffix=suffix, receiver_key=receiver_key
    )
    stream_id = int(stack["stream_id"])
    wm_path = f"/source-e2e/ext-wh-burst-{suffix}"
    ensure_source_e2e_webhook_stub(WIREMOCK_BASE)
    reset_wiremock_journal(WIREMOCK_BASE)
    wiremock_route(client, stream_id, wm_path)

    def _post(i: int) -> tuple[int, str | None, str | None]:
        r = post_webhook_ingest(
            client,
            receiver_key,
            json_body={"id": f"burst-{i}", "message": f"msg-{i}"},
            headers={"X-GDC-Webhook-Secret": stack["shared_secret"]},
        )
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        outcome = (body.get("summary") or {}).get("outcome")
        err = None
        if isinstance(body.get("detail"), dict):
            err = body["detail"].get("error_code")
        return r.status_code, outcome, err

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = [f.result() for f in as_completed(pool.submit(_post, i) for i in range(5))]
    # One run executes (200); concurrent lock contention must be explicit 409 — never silent 2xx skip.
    assert sum(1 for code, _, _ in results if code == 200) == 1
    assert sum(1 for code, _, _ in results if code == 409) == 4
    assert all(code in (200, 409) for code, _, _ in results)
    outcomes = [outcome for _, outcome, _ in results]
    assert outcomes.count("completed") == 1
    error_codes = [err for _, _, err in results if err]
    assert error_codes.count("RUN_ALREADY_ACTIVE") == 4
    wait_for_delivery_log_stage(db_session, stream_id, "route_send_success", min_count=1)
    bodies = wiremock_received_json_bodies(WIREMOCK_BASE, path_contains=wm_path)
    assert len(bodies) == 1


# --- Multi-route fan-out (polling sources) ---


@skip_no_wiremock
@skip_no_pg
@pytest.mark.e2e_runtime
def test_database_query_multi_route_partial_failure_checkpoint_advances(
    client: TestClient, db_session: Session
) -> None:
    reset_pg_fixture_seed()
    suffix = uuid.uuid4().hex[:8]
    _, _, stream_id = create_db_query_connector_and_stream(
        client, name_suffix=suffix, stream_config=dict(_DB_QUERY)
    )
    save_mapping_enrichment(client, stream_id)
    ensure_source_e2e_webhook_stub(WIREMOCK_BASE)
    ensure_template_wiremock_mappings(WIREMOCK_BASE)
    reset_wiremock_journal(WIREMOCK_BASE)
    wiremock_route(client, stream_id, f"/source-e2e/ext-db-mr-ok-{suffix}")
    wiremock_route(
        client,
        stream_id,
        "/wiremock-integration/receiver-fail",
        failure_policy="LOG_AND_CONTINUE",
        retry_count=0,
    )
    ensure_checkpoint(db_session, stream_id)
    enable_stream_for_run(client, stream_id)

    run = client.post(f"/api/v1/runtime/streams/{stream_id}/run-once")
    assert run.status_code == 200
    assert run.json().get("checkpoint_updated") is True
    stages = delivery_log_stages(db_session, stream_id)
    assert "route_send_success" in stages
    assert "route_send_failed" in stages
    assert_run_observability_core(db_session, stream_id, expect_checkpoint_update=True)


# --- Runtime observability ---


@skip_no_wiremock
@skip_no_minio
@pytest.mark.minio
@pytest.mark.e2e_runtime
def test_runtime_observability_after_s3_run(
    client: TestClient, db_session: Session
) -> None:
    suffix = uuid.uuid4().hex[:8]
    prefix = seed_isolated_s3_objects(
        suffix,
        {"obs.ndjson": b'{"id":"obs-1","message":"observability","severity":"info"}\n'},
    )
    _, _, stream_id = create_s3_connector_and_stream(
        client,
        name_suffix=suffix,
        prefix=prefix,
        stream_config={"max_objects_per_run": 5},
    )
    save_mapping_enrichment(client, stream_id)
    prepare_wiremock_run(client, stream_id, f"/source-e2e/ext-obs-{suffix}")
    ensure_checkpoint(db_session, stream_id)

    run_once(client, stream_id)
    assert_observability_after_success(client, db_session, stream_id)
