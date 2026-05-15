from __future__ import annotations

import pytest

from app.parsers.event_extractor import extract_events
from app.runtime.preview_service import PreviewRequestError, run_mapping_draft_preview
from app.runtime.schemas import MappingDraftPreviewRequest


def test_event_array_path_only_preserves_existing_behavior() -> None:
    raw = {"hits": {"hits": [{"id": "a"}, {"id": "b"}]}}
    events = extract_events(raw, "$.hits.hits")
    assert events == [{"id": "a"}, {"id": "b"}]


def test_event_array_and_event_root_extract_nested_record() -> None:
    raw = {
        "hits": {
            "hits": [
                {"_index": "idx", "_source": {"srcip": "1.1.1.1", "dstip": "2.2.2.2"}},
            ]
        }
    }
    events = extract_events(raw, "$.hits.hits", "$._source")
    assert events == [{"srcip": "1.1.1.1", "dstip": "2.2.2.2"}]


def test_invalid_event_root_path_returns_clear_preview_error() -> None:
    payload = MappingDraftPreviewRequest(
        payload={"hits": {"hits": [{"_source": {"srcip": "1.1.1.1"}}]}},
        event_array_path="$.hits.hits",
        event_root_path="$.payload",
        field_mappings={"srcip": "$.srcip"},
        max_events=5,
    )
    with pytest.raises(PreviewRequestError) as exc:
        run_mapping_draft_preview(payload)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "EVENT_EXTRACTION_FAILED"
    assert "event_root_path did not match" in str(exc.value.detail["message"])


def test_mapping_preview_uses_extracted_event_root_not_wrapper() -> None:
    payload = MappingDraftPreviewRequest(
        payload={
            "hits": {
                "hits": [
                    {"_source": {"srcip": "1.1.1.1", "dstip": "2.2.2.2"}, "_id": "x"},
                ]
            }
        },
        event_array_path="$.hits.hits",
        event_root_path="$._source",
        field_mappings={"src": "$.srcip", "dst": "$.dstip"},
        max_events=5,
    )
    out = run_mapping_draft_preview(payload)
    assert out.preview_event_count == 1
    assert out.mapped_events[0] == {"src": "1.1.1.1", "dst": "2.2.2.2"}
