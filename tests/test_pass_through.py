"""Tests for unknown field pass-through helpers."""

from __future__ import annotations

from app.mappers.pass_through import (
    build_residual_after_mapping,
    deep_merge_pass_through,
    merge_unknown_field_pass_through,
    parse_jsonpath_segments,
    remove_at_jsonpath,
)


def test_parse_jsonpath_segments() -> None:
    assert parse_jsonpath_segments("$.user.name") == ["user", "name"]
    assert parse_jsonpath_segments("$.items[0].tag") == ["items", 0, "tag"]


def test_merge_unknown_field_pass_through_top_level() -> None:
    event = {"user": "aaa", "email": "aaa@test.com", "phone": "010"}
    mapped = {"user": "aaa", "email": "aaa@test.com"}
    out = merge_unknown_field_pass_through(event, mapped, ("$.user", "$.email"))
    assert out == {"user": "aaa", "email": "aaa@test.com", "phone": "010"}


def test_nested_sibling_pass_through() -> None:
    event = {"user": {"name": "aaa", "department": "sales"}}
    mapped = {"user_name": "aaa"}
    out = merge_unknown_field_pass_through(event, mapped, ("$.user.name",))
    assert out == {"user_name": "aaa", "user": {"department": "sales"}}


def test_array_element_partial_pass_through() -> None:
    event = {"items": [{"id": 1, "tag": "a"}, {"id": 2, "tag": "b"}]}
    mapped = {"first_tag": "a"}
    out = merge_unknown_field_pass_through(event, mapped, ("$.items[0].tag",))
    assert out == {
        "first_tag": "a",
        "items": [{"id": 1}, {"id": 2, "tag": "b"}],
    }


def test_remove_at_jsonpath_nested() -> None:
    root = {"user": {"name": "aaa", "department": "sales"}}
    remove_at_jsonpath(root, "$.user.name")
    assert root == {"user": {"department": "sales"}}


def test_build_residual_after_mapping() -> None:
    event = {"user": {"name": "aaa", "department": "sales"}, "email": "e@test.com"}
    residual = build_residual_after_mapping(event, ("$.user.name", "$.email"))
    assert residual == {"user": {"department": "sales"}}


def test_deep_merge_pass_through_preserves_output() -> None:
    output = {"user_name": "aaa"}
    residual = {"user": {"department": "sales"}}
    merged = deep_merge_pass_through(output, residual)
    assert merged == {"user_name": "aaa", "user": {"department": "sales"}}
