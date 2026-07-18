"""Type Conversion transform — unit and enrichment integration tests."""

from __future__ import annotations

from app.enrichers.enrichment_engine import apply_enrichment, apply_enrichments_batch
from app.enrichers.rule_validation import validate_enrichment_json
from app.enrichers.type_conversion import (
    convert_type,
    coerce_value,
    normalize_target_type,
)


def test_string_to_integer() -> None:
    result = convert_type("5", target_type="integer")
    assert result.value == 5
    assert not result.skipped


def test_string_to_float() -> None:
    result = convert_type("3.14", target_type="float")
    assert result.value == 3.14


def test_string_to_boolean_true() -> None:
    result = convert_type("true", target_type="boolean")
    assert result.value is True


def test_string_to_boolean_false() -> None:
    result = convert_type("false", target_type="boolean")
    assert result.value is False


def test_json_string_to_array() -> None:
    result = convert_type('["edr", "alert"]', target_type="array")
    assert result.value == ["edr", "alert"]


def test_json_string_to_object() -> None:
    result = convert_type('{"a": 1}', target_type="object")
    assert result.value == {"a": 1}


def test_on_failure_keep_original() -> None:
    result = convert_type("not-a-number", target_type="integer", on_failure="keep_original")
    assert result.value == "not-a-number"
    assert result.warning


def test_on_failure_set_null() -> None:
    result = convert_type("not-a-number", target_type="integer", on_failure="set_null")
    assert result.value is None
    assert result.warning


def test_on_failure_drop_field() -> None:
    result = convert_type("not-a-number", target_type="integer", on_failure="drop_field")
    assert result.dropped is True


def test_on_failure_skip_event() -> None:
    result = convert_type("not-a-number", target_type="integer", on_failure="skip_event")
    assert result.skipped is True


def test_enrichment_apply_string_to_integer() -> None:
    enrichment = {
        "__rules": {
            "severity": {
                "type": "type_conversion",
                "source_field": "severity",
                "target_type": "integer",
                "on_failure": "keep_original",
            }
        }
    }
    event = {"severity": "5"}
    result = apply_enrichment(event, enrichment, override_policy="OVERRIDE")
    assert result["severity"] == 5


def test_enrichment_inplace_conversion() -> None:
    enrichment = {
        "__rules": {
            "enabled": {
                "type": "type_conversion",
                "source_field": "enabled",
                "target_type": "boolean",
                "on_failure": "keep_original",
            }
        }
    }
    event = {"enabled": "true"}
    result = apply_enrichment(event, enrichment, override_policy="OVERRIDE")
    assert result["enabled"] is True


def test_enrichment_different_target_field() -> None:
    enrichment = {
        "__rules": {
            "severity_num": {
                "type": "type_conversion",
                "source_field": "severity",
                "target_type": "integer",
                "on_failure": "keep_original",
            }
        }
    }
    event = {"severity": "9"}
    result = apply_enrichment(event, enrichment, override_policy="OVERRIDE")
    assert result["severity"] == "9"
    assert result["severity_num"] == 9


def test_enrichment_skip_event() -> None:
    enrichment = {
        "__rules": {
            "count": {
                "type": "type_conversion",
                "source_field": "count",
                "target_type": "integer",
                "on_failure": "skip_event",
            }
        }
    }
    batch = apply_enrichments_batch(
        [{"count": "bad"}],
        enrichment,
        override_policy="OVERRIDE",
    )
    assert len(batch.events) == 0
    assert batch.skipped_count == 1


def test_validation_missing_source_field() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "x": {
                    "type": "type_conversion",
                    "target_type": "integer",
                }
            }
        }
    )
    assert any(i.code == "missing_source_field" for i in result.issues)


def test_validation_missing_target_type() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "x": {
                    "type": "type_conversion",
                    "source_field": "a",
                }
            }
        }
    )
    assert any(i.code == "missing_target_type" for i in result.issues)


def test_normalize_target_type_aliases() -> None:
    assert normalize_target_type("int") == "integer"
    assert normalize_target_type("bool") == "boolean"
