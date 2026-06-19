"""Functional regression E2E: Record Selection contract through StreamRunner delivery."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.parsers.event_extractor import extract_events
from app.runtime.preview_service import run_mapping_draft_preview
from app.runtime.schemas import MappingDraftPreviewRequest
from app.templates.registry import clear_template_cache
from tests.e2e_wiremock_helpers import (
    create_webhook_destination,
    delivery_log_stages,
    reset_wiremock_journal,
)
from tests.functional_regression_helpers import (
    FUNCTIONAL_REGRESSION_WIREMOCK,
    assert_delivery_stages,
    attach_webhook_route,
    captured_webhook_payloads,
    checkpoint_value,
    create_bearer_http_polling_stack,
    ensure_checkpoint_row,
    ensure_functional_regression_wiremock_mappings,
    prepare_functional_regression_run,
    run_stream_once,
    save_record_selection_mapping,
    save_stream_enrichment,
    wiremock_reachable,
)

pytestmark = [
    pytest.mark.functional_regression,
    pytest.mark.wiremock_integration,
    pytest.mark.e2e_delivery,
]

skip_no_wiremock = pytest.mark.skipif(
    not wiremock_reachable(),
    reason=f"WireMock not reachable at {FUNCTIONAL_REGRESSION_WIREMOCK} (start: ./scripts/testing/start-test-stack.sh)",
)

RECORDS_ENVELOPE = {
    "Records": [
        {
            "event": {
                "id": 1,
                "eventVersion": "1.0",
                "eventTime": "2026-05-11T12:00:00Z",
            },
            "ResponseMetadata": {"RequestId": "req-abc"},
        }
    ],
    "wrapper": True,
    "ResponseMetadata": {"RequestId": "envelope-top"},
}

ROOT_ARRAY_PAYLOAD = [
    {
        "id": "root-1",
        "creationTime": "2026-05-11T12:00:00Z",
        "message": "root array event one",
        "severity": "INFO",
    }
]


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


def test_runtime_extract_events_records_event_root_contract() -> None:
    events = extract_events(RECORDS_ENVELOPE, "$.Records", "$.event")
    assert events == [
        {
            "id": 1,
            "eventVersion": "1.0",
            "eventTime": "2026-05-11T12:00:00Z",
        }
    ]
    assert "Records" not in events[0]
    assert "ResponseMetadata" not in events[0]


def test_runtime_extract_events_root_array_without_event_root() -> None:
    events = extract_events(ROOT_ARRAY_PAYLOAD, "$")
    assert events == ROOT_ARRAY_PAYLOAD


def test_mapping_preview_uses_relative_paths_for_records_event_root() -> None:
    out = run_mapping_draft_preview(
        MappingDraftPreviewRequest(
            payload=RECORDS_ENVELOPE,
            event_array_path="$.Records",
            event_root_path="$.event",
            field_mappings={
                "event_id": "$.id",
                "event_time": "$.eventTime",
            },
            max_events=5,
        )
    )
    assert out.preview_event_count == 1
    # Draft preview passes unmapped source fields through (merge_unknown_field_pass_through).
    assert out.mapped_events[0] == {
        "event_id": 1,
        "event_time": "2026-05-11T12:00:00Z",
        "eventVersion": "1.0",
    }


@skip_no_wiremock
def test_e2e_records_event_root_delivers_nested_event_only(
    client: TestClient, db_session: Session
) -> None:
    base = FUNCTIONAL_REGRESSION_WIREMOCK
    ensure_functional_regression_wiremock_mappings(base)
    reset_wiremock_journal(base)

    suffix = uuid.uuid4().hex[:8]
    receiver_path = f"/functional-regression/receiver/{suffix}"
    stack = create_bearer_http_polling_stack(
        client,
        base,
        name_suffix=suffix,
        endpoint="/api/v1/functional-regression/records-envelope",
    )
    stream_id = int(stack["stream_id"])

    save_record_selection_mapping(
        client,
        stream_id,
        event_array_path="$.Records",
        event_root_path="$.event",
        field_mappings={
            "event_id": "$.id",
            "event_time": "$.eventTime",
            "event_version": "$.eventVersion",
        },
    )
    save_stream_enrichment(
        client,
        stream_id,
        enrichment={"pipeline": "functional-regression", "vendor": "RecordSelectionE2E"},
    )

    ensure_checkpoint_row(db_session, stream_id)
    cp_before = checkpoint_value(db_session, stream_id)
    prepare_functional_regression_run(
        client,
        db_session,
        stream_id,
        wiremock_base=base,
        receiver_path=receiver_path,
    )

    body = run_stream_once(client, stream_id)
    assert int(body.get("extracted_event_count") or 0) >= 1
    assert body.get("checkpoint_updated") is True

    payloads = captured_webhook_payloads(base, path_contains=receiver_path)
    assert payloads, "expected at least one webhook delivery"
    sample = payloads[-1]
    assert sample.get("event_id") in (1, 2)
    assert sample.get("pipeline") == "functional-regression"
    assert sample.get("vendor") == "RecordSelectionE2E"
    assert "Records" not in sample
    assert "ResponseMetadata" not in sample
    assert "wrapper" not in sample

    cp_after = checkpoint_value(db_session, stream_id)
    assert cp_after != cp_before
    assert cp_after.get("last_success_event", {}).get("event_id") in (1, 2)

    assert body.get("checkpoint_updated") is True


@skip_no_wiremock
def test_e2e_root_array_without_event_root_delivers_full_records(
    client: TestClient, db_session: Session
) -> None:
    base = FUNCTIONAL_REGRESSION_WIREMOCK
    ensure_functional_regression_wiremock_mappings(base)
    reset_wiremock_journal(base)

    suffix = uuid.uuid4().hex[:8]
    receiver_path = f"/functional-regression/root-array/{suffix}"
    stack = create_bearer_http_polling_stack(
        client,
        base,
        name_suffix=suffix,
        endpoint="/api/v1/functional-regression/root-array",
    )
    stream_id = int(stack["stream_id"])

    save_record_selection_mapping(
        client,
        stream_id,
        event_array_path=None,
        event_root_path=None,
        field_mappings={
            "event_id": "$.id",
            "message": "$.message",
            "severity": "$.severity",
        },
    )
    save_stream_enrichment(client, stream_id, enrichment={"pipeline": "root-array-e2e"})

    prepare_functional_regression_run(
        client,
        db_session,
        stream_id,
        wiremock_base=base,
        receiver_path=receiver_path,
    )

    body = run_stream_once(client, stream_id)
    assert int(body.get("extracted_event_count") or 0) >= 1
    assert body.get("checkpoint_updated") is True

    payloads = captured_webhook_payloads(base, path_contains=receiver_path)
    assert payloads
    ids = {p.get("event_id") for p in payloads}
    assert ids & {"root-1", "root-2"}
    sample = payloads[-1]
    assert sample.get("pipeline") == "root-array-e2e"
    assert sample.get("message")
    assert sample.get("severity")


@skip_no_wiremock
def test_e2e_destination_failure_does_not_advance_checkpoint(
    client: TestClient, db_session: Session
) -> None:
    base = FUNCTIONAL_REGRESSION_WIREMOCK
    ensure_functional_regression_wiremock_mappings(base)
    reset_wiremock_journal(base)

    suffix = uuid.uuid4().hex[:8]
    stack = create_bearer_http_polling_stack(
        client,
        base,
        name_suffix=suffix,
        endpoint="/api/v1/functional-regression/records-envelope",
    )
    stream_id = int(stack["stream_id"])

    save_record_selection_mapping(
        client,
        stream_id,
        event_array_path="$.Records",
        event_root_path="$.event",
        field_mappings={"event_id": "$.id", "event_time": "$.eventTime"},
    )
    save_stream_enrichment(client, stream_id, enrichment={"pipeline": "failure-e2e"})

    ensure_checkpoint_row(db_session, stream_id)
    cp_before = checkpoint_value(db_session, stream_id)
    prepare_functional_regression_run(
        client,
        db_session,
        stream_id,
        wiremock_base=base,
        receiver_path="/wiremock-integration/receiver-fail",
        failure_policy="PAUSE_STREAM_ON_FAILURE",
    )

    body = run_stream_once(client, stream_id)
    assert int(body.get("extracted_event_count") or 0) >= 1
    assert body.get("checkpoint_updated") is False

    cp_after = checkpoint_value(db_session, stream_id)
    assert cp_after == cp_before

    assert_delivery_stages(
        db_session,
        stream_id,
        expect_success=False,
        expect_failure=True,
        expect_checkpoint_log=False,
    )
    assert "route_send_success" not in delivery_log_stages(db_session, stream_id)

    st = client.get(f"/api/v1/streams/{stream_id}").json()
    assert st.get("status") == "PAUSED"


@skip_no_wiremock
def test_e2e_multi_route_fanout_same_mapped_enriched_event(
    client: TestClient, db_session: Session
) -> None:
    base = FUNCTIONAL_REGRESSION_WIREMOCK
    ensure_functional_regression_wiremock_mappings(base)
    reset_wiremock_journal(base)

    suffix = uuid.uuid4().hex[:8]
    receiver_a = f"/functional-regression/multi-a/{suffix}"
    receiver_b = f"/functional-regression/multi-b/{suffix}"
    stack = create_bearer_http_polling_stack(
        client,
        base,
        name_suffix=suffix,
        endpoint="/api/v1/functional-regression/records-envelope",
    )
    stream_id = int(stack["stream_id"])

    save_record_selection_mapping(
        client,
        stream_id,
        event_array_path="$.Records",
        event_root_path="$.event",
        field_mappings={"event_id": "$.id", "event_time": "$.eventTime"},
    )
    save_stream_enrichment(client, stream_id, enrichment={"pipeline": "multi-route-e2e"})

    run_meta = prepare_functional_regression_run(
        client,
        db_session,
        stream_id,
        wiremock_base=base,
        receiver_path=receiver_a,
    )
    dest_b = create_webhook_destination(client, base, path=receiver_b)
    route_b = attach_webhook_route(client, stream_id, dest_b)

    body = run_stream_once(client, stream_id)
    assert int(body.get("extracted_event_count") or 0) >= 1
    assert body.get("checkpoint_updated") is True

    payloads_a = captured_webhook_payloads(base, path_contains=receiver_a)
    payloads_b = captured_webhook_payloads(base, path_contains=receiver_b)
    assert payloads_a and payloads_b

    sample_a = payloads_a[-1]
    sample_b = next((p for p in payloads_b if p.get("event_id") == sample_a.get("event_id")), payloads_b[-1])
    assert sample_a.get("event_time") == sample_b.get("event_time")
    assert sample_a.get("pipeline") == sample_b.get("pipeline") == "multi-route-e2e"
    assert "Records" not in sample_a
    assert "Records" not in sample_b

    assert body.get("checkpoint_updated") is True
