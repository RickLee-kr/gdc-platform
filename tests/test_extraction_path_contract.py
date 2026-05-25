"""Unit tests for Record Selection / runtime extraction path contract helpers."""

from __future__ import annotations

import pytest
from app.parsers.extraction_paths import (
    absolute_path_in_sample_record,
    checkpoint_path_from_click,
    event_root_path_from_click,
    format_checkpoint_applies_to,
    format_preview_sample_path,
    format_runtime_extraction_path,
    is_envelope_relative_mapping_path,
    is_preview_only_array_path,
    normalize_event_array_path,
    to_checkpoint_relative_path,
)

pytestmark = pytest.mark.functional_regression


def test_normalize_event_array_path_strips_preview_index() -> None:
    assert normalize_event_array_path("$.Records[0]") == "$.Records"
    assert normalize_event_array_path("$.data.events[2]") == "$.data.events"
    assert normalize_event_array_path("$.Records[*]") == "$.Records"


def test_format_runtime_extraction_path_records_with_event_root() -> None:
    assert format_runtime_extraction_path("$.Records", "$.event") == "$.Records[*].event"


def test_format_runtime_extraction_path_root_array_without_event_root() -> None:
    assert format_runtime_extraction_path("$", "$.roles") == "$[*].roles"
    assert format_runtime_extraction_path("$", "") == "$[*]"


def test_format_preview_sample_path_uses_index_not_wildcard() -> None:
    assert format_preview_sample_path("$.Records", 0) == "$.Records[0]"
    assert format_preview_sample_path("$", 0) == "$[0]"


def test_event_root_path_from_click_named_array() -> None:
    assert event_root_path_from_click("$.Records[0].event", "$.Records") == "$.event"


def test_event_root_path_from_click_root_array() -> None:
    assert event_root_path_from_click("$[0].roles", "$") == "$.roles"


def test_checkpoint_path_from_click_relative_to_extracted_event() -> None:
    assert checkpoint_path_from_click("$.Records[0].event.eventTime", "$.Records", 0) == "$.event.eventTime"
    assert (
        to_checkpoint_relative_path("$.Records[0].event.eventTime", "$.Records", "$.event", 0)
        == "$.event.eventTime"
    )
    assert checkpoint_path_from_click("$.Records[0].eventTime", "$.Records", 0) == "$.eventTime"


def test_checkpoint_path_from_click_root_array_sample() -> None:
    assert checkpoint_path_from_click("$[0].creationTime", "$", 0) == "$.creationTime"


def test_format_checkpoint_applies_to_runtime_scope() -> None:
    assert format_checkpoint_applies_to("$", "$.creationTime") == "$[*].creationTime"
    assert format_checkpoint_applies_to("$.Records", "$.event.eventTime") == "$.Records[*].event.eventTime"


def test_absolute_path_in_sample_record() -> None:
    assert absolute_path_in_sample_record("$.Records", "$.event", 0) == "$.Records[0].event"
    assert absolute_path_in_sample_record("$", "$.roles", 0) == "$[0].roles"


def test_is_preview_only_array_path() -> None:
    assert is_preview_only_array_path("$.Records[0]") is True
    assert is_preview_only_array_path("$.Records") is False


@pytest.mark.parametrize(
    "path,event_array,event_root,expected",
    [
        ("$.eventTime", "$.Records", "$.event", False),
        ("$.id", "$", "", False),
        ("$.user.name", "$.Records", "$.event", False),
        ("$.Records[0].event.eventTime", "$.Records", "$.event", True),
        ("$.Records[*].event.eventTime", "$.Records", "$.event", True),
        ("$[0].id", "$", "", True),
        ("$[*].id", "$", "", True),
    ],
)
def test_is_envelope_relative_mapping_path(path: str, event_array: str, event_root: str, expected: bool) -> None:
    assert is_envelope_relative_mapping_path(path, event_array, event_root) is expected
