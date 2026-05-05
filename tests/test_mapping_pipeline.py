"""Tests for JSONPath parsing, event extraction, mapping, enrichment, and preview."""

from __future__ import annotations

import copy

import pytest

from app.enrichers.enrichment_engine import (
    apply_enrichment,
    apply_enrichments,
)
from app.mappers.mapper import (
    apply_compiled_mapping,
    apply_compiled_mappings,
    apply_mapping,
    apply_mappings,
    build_preview,
    compile_mappings,
)
from app.parsers.event_extractor import extract_events
from app.parsers.jsonpath_parser import _compile, extract_all, extract_one, extract_one_compiled
from app.runtime.errors import EnrichmentError, MappingError, ParserError


def test_extract_one_simple_field() -> None:
    data = {"id": "abc", "severity": "high"}
    assert extract_one(data, "$.id") == "abc"
    assert extract_one(data, "$.missing", default="x") == "x"


def test_extract_one_root_path_returns_dict() -> None:
    payload = {"a": 1}
    assert extract_one(payload, "$") is payload
    assert extract_one(payload, "  ") is payload
    assert extract_one(payload, None) is payload


def test_extract_all_collects_matches() -> None:
    data = {"items": [{"x": 1}, {"x": 2}]}
    values = extract_all(data, "$.items[*].x")
    assert values == [1, 2]


def test_invalid_jsonpath_raises_parser_error() -> None:
    with pytest.raises(ParserError):
        extract_one({"a": 1}, "$$$")


def test_jsonpath_compile_cache_reuse() -> None:
    before = _compile.cache_info().hits
    extract_one({"a": 1}, "$.a")
    extract_one({"a": 2}, "$.a")
    extract_one({"a": 3}, "$.a")
    after = _compile.cache_info().hits
    assert after >= before + 2


def test_extract_events_with_array_path() -> None:
    raw = {"data": {"items": [{"id": 1}, {"id": 2}]}}
    events = extract_events(raw, "$.data.items")
    assert events == [{"id": 1}, {"id": 2}]


def test_extract_events_single_object_path_wraps_list() -> None:
    raw = {"record": {"id": "solo"}}
    assert extract_events(raw, "$.record") == [{"id": "solo"}]


def test_extract_events_without_path_dict_wraps() -> None:
    raw = {"foo": "bar"}
    events = extract_events(raw, None)
    assert events == [raw]
    assert events[0] is not raw


def test_extract_events_without_path_list_only_dicts() -> None:
    events = extract_events([{"a": 1}, {"b": 2}], None)
    assert events == [{"a": 1}, {"b": 2}]


def test_extract_events_invalid_list_element_raises() -> None:
    with pytest.raises(MappingError):
        extract_events([{"ok": True}, 123], None)


def test_mapping_success() -> None:
    event = {
        "id": "abc-123",
        "severity": "high",
        "machine": {"name": "host01"},
        "user": {"name": "kim"},
    }
    rules = {
        "event_id": "$.id",
        "severity": "$.severity",
        "host_name": "$.machine.name",
        "user_name": "$.user.name",
    }
    assert apply_mapping(event, rules) == {
        "event_id": "abc-123",
        "severity": "high",
        "host_name": "host01",
        "user_name": "kim",
    }


def test_mapping_missing_paths_are_none() -> None:
    assert apply_mapping({"a": 1}, {"out": "$.nope"}) == {"out": None}


def test_mapping_invalid_path_wraps_parser_error() -> None:
    with pytest.raises(MappingError):
        apply_mapping({"a": 1}, {"bad": "$$$"})


def test_mapping_empty_rules_returns_empty_dict() -> None:
    assert apply_mapping({"a": 1}, {}) == {}


def test_apply_mappings_batch() -> None:
    events = [{"x": 1}, {"x": 2}]
    assert apply_mappings(events, {"y": "$.x"}) == [{"y": 1}, {"y": 2}]


def test_mapping_nested_object_deepcopy() -> None:
    event = {"machine": {"name": "host01"}}
    mapped = apply_mapping(event, {"machine": "$.machine"})
    mapped["machine"]["name"] = "changed"
    assert event["machine"]["name"] == "host01"


def test_enrichment_keep_existing() -> None:
    base = {"vendor": "orig", "severity": "high"}
    enriched = apply_enrichment(
        base,
        {"vendor": "new", "product": "EDR"},
        override_policy="KEEP_EXISTING",
    )
    assert enriched["vendor"] == "orig"
    assert enriched["product"] == "EDR"


def test_enrichment_override() -> None:
    base = {"vendor": "orig"}
    enriched = apply_enrichment(base, {"vendor": "CrowdStrike"}, override_policy="OVERRIDE")
    assert enriched["vendor"] == "CrowdStrike"


def test_enrichment_error_on_conflict() -> None:
    with pytest.raises(EnrichmentError):
        apply_enrichment({"vendor": "x"}, {"vendor": "y"}, override_policy="ERROR_ON_CONFLICT")


def test_enrichment_unknown_policy_errors() -> None:
    with pytest.raises(EnrichmentError):
        apply_enrichment({}, {"k": "v"}, override_policy="NOPE")


def test_enrichment_rejects_callables() -> None:
    with pytest.raises(EnrichmentError):
        apply_enrichment({"a": 1}, {"bad": lambda: 1})  # type: ignore[arg-type]


def test_original_event_not_mutated_mapping() -> None:
    event = {"id": 1}
    snapshot = copy.deepcopy(event)
    apply_mapping(event, {"x": "$.id"})
    assert event == snapshot


def test_original_event_not_mutated_enrichment() -> None:
    event = {"a": 1}
    snapshot = copy.deepcopy(event)
    apply_enrichment(event, {"b": 2})
    assert event == snapshot


def test_event_extractor_deepcopy() -> None:
    raw = {"events": [{"meta": {"a": 1}}]}
    events = extract_events(raw, "$.events")
    events[0]["meta"]["a"] = 999
    assert raw["events"][0]["meta"]["a"] == 1


def test_enrichment_deepcopy_existing_nested_fields() -> None:
    event = {"details": {"a": 1}}
    enriched = apply_enrichment(event, {"vendor": "x"})
    enriched["details"]["a"] = 999
    assert event["details"]["a"] == 1


def test_enrichment_value_deepcopy() -> None:
    extra = {"tags": ["a"]}
    enriched = apply_enrichment({}, {"extra": extra})
    enriched["extra"]["tags"].append("b")
    assert extra["tags"] == ["a"]


def test_build_preview_end_to_end() -> None:
    raw = {"events": [{"id": "1", "severity": "low"}, {"id": "2", "severity": "high"}]}
    mapped_preview = build_preview(
        raw_response=raw,
        event_array_path="$.events[*]",
        field_mappings={"event_id": "$.id", "severity": "$.severity"},
        enrichment={"vendor": "Acme", "product": "NGFW"},
        override_policy="KEEP_EXISTING",
    )
    assert mapped_preview == [
        {"event_id": "1", "severity": "low", "vendor": "Acme", "product": "NGFW"},
        {"event_id": "2", "severity": "high", "vendor": "Acme", "product": "NGFW"},
    ]


def test_extract_events_empty_array_path_result() -> None:
    raw = {"items": []}
    assert extract_events(raw, "$.items") == []


def test_compile_mappings_and_apply_compiled_mapping() -> None:
    compiled = compile_mappings({"event_id": "$.id", "severity": "$.severity"})
    out = apply_compiled_mapping({"id": "abc", "severity": "high"}, compiled)
    assert out == {"event_id": "abc", "severity": "high"}


def test_apply_compiled_mappings_batch() -> None:
    compiled = compile_mappings({"event_id": "$.id"})
    out = apply_compiled_mappings([{"id": "1"}, {"id": "2"}], compiled)
    assert out == [{"event_id": "1"}, {"event_id": "2"}]


def test_compile_mappings_invalid_jsonpath_raises_mapping_error() -> None:
    with pytest.raises(MappingError):
        compile_mappings({"bad": "$$$"})


def test_compiled_mapping_root_path_deepcopy() -> None:
    event = {"id": "1", "nested": {"a": 1}}
    compiled = compile_mappings({"raw_event": "$"})
    mapped = apply_compiled_mapping(event, compiled)

    assert mapped["raw_event"] == event
    assert mapped["raw_event"] is not event
    mapped["raw_event"]["nested"]["a"] = 999
    assert event["nested"]["a"] == 1


def test_extract_one_compiled_non_dict_input_raises() -> None:
    compiled = compile_mappings({"x": "$.id"})["x"]
    with pytest.raises(MappingError):
        extract_one_compiled(compiled, ["not", "a", "dict"])  # type: ignore[arg-type]
