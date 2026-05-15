from __future__ import annotations

import pytest

from app.runtime.response_analysis import (
    build_http_api_test_analysis_dict,
    detect_checkpoint_candidates,
    detect_event_array_candidates,
)


def test_detect_arrays_items_and_nested_data_events() -> None:
    body = {"items": [{"id": "a"}, {"id": "b"}]}
    c = detect_event_array_candidates(body)
    paths = [x["path"] for x in c]
    assert "$.items" in paths

    body2 = {"data": {"events": [{"x": 1}], "meta": {}}}
    c2 = detect_event_array_candidates(body2)
    assert any(x["path"] == "$.data.events" for x in c2)


def test_detect_arrays_malops() -> None:
    body = {"malops": [{"guid": "g1"}, {"guid": "g2"}]}
    c = detect_event_array_candidates(body)
    assert any(x["path"] == "$.malops" for x in c)


def test_nested_array_inside_object_walk() -> None:
    body = {"outer": {"inner": [{"k": 1}, {"k": 2}]}}
    c = detect_event_array_candidates(body)
    assert any(x["path"] == "$.outer.inner" for x in c)


def test_checkpoint_timestamps_and_ids() -> None:
    sample = {"creationTime": "2026-01-01T00:00:00Z", "id": "evt-1", "machine": {"name": "h1"}}
    root = {"next_cursor": "c1", "data": {}}
    hits = detect_checkpoint_candidates(root, sample)
    types = {h["checkpoint_type"] for h in hits}
    paths = {h["field_path"] for h in hits}
    assert "TIMESTAMP" in types
    assert "EVENT_ID" in types
    assert "CURSOR" in types
    assert "$.creationTime" in paths or any("creationTime" in p for p in paths)
    assert "$.next_cursor" in paths


def test_build_http_api_test_analysis_contract() -> None:
    parsed = {"items": [{"id": 1, "updated_at": "2026-05-09"}]}
    out = build_http_api_test_analysis_dict(
        parsed,
        raw_body='{"items":[]}',
        raw_body_length=12,
        body_truncated=False,
        content_type="application/json",
        event_array_hint="$.items",
    )
    assert out["preview_error"] is None
    assert out["response_summary"]["root_type"] == "object"
    assert out["selected_event_array_default"] == "$.items"
    assert isinstance(out["detected_arrays"], list)
    assert isinstance(out["detected_checkpoint_candidates"], list)
    assert out["sample_event"] is not None
    assert isinstance(out["flat_preview_fields"], list)


def test_build_analysis_invalid_json_preview_error() -> None:
    out = build_http_api_test_analysis_dict(
        None,
        raw_body="{not json",
        raw_body_length=10,
        body_truncated=False,
        content_type="application/json",
        event_array_hint=None,
    )
    assert out["preview_error"] == "invalid_json_response"
    assert out["detected_arrays"] == []


def test_build_analysis_unsupported_html() -> None:
    out = build_http_api_test_analysis_dict(
        None,
        raw_body="<html><body>no</body></html>",
        raw_body_length=30,
        body_truncated=False,
        content_type="text/html",
        event_array_hint=None,
    )
    assert out["preview_error"] == "unsupported_content_type"
