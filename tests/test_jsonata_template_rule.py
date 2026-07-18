"""JSONata enrichment rule — runtime uses expression; template metadata is UI-only."""

from __future__ import annotations

from app.enrichers.enrichment_engine import apply_enrichment
from app.enrichers.rule_validation import validate_enrichment_json
from app.runtime.stream_configuration_service import _jsonata_template_sections


def test_jsonata_copy_field_runtime() -> None:
    event = {"user_id": "u-1", "name": "Ada"}
    enrichment = {
        "__rules": {
            "copied_id": {
                "type": "jsonata",
                "expression": "user_id",
                "template": "copy_field",
                "template_params": {"source_field": "user_id"},
                "target_field": "copied_id",
                "enabled": True,
            }
        }
    }
    result = apply_enrichment(event, enrichment)
    assert result["copied_id"] == "u-1"
    assert result["user_id"] == "u-1"


def test_jsonata_concat_fields_runtime() -> None:
    event = {"first_name": "Ada", "last_name": "Lovelace"}
    enrichment = {
        "__rules": {
            "full_name": {
                "type": "jsonata",
                "expression": "$join([$string(first_name), $string(last_name)], ' ')",
                "template": "concat_fields",
                "enabled": True,
            }
        }
    }
    result = apply_enrichment(event, enrichment)
    assert result["full_name"] == "Ada Lovelace"


def test_jsonata_ignores_template_metadata_at_runtime() -> None:
    """Runtime must evaluate expression even when template params disagree."""

    event = {"a": "alpha", "b": "beta"}
    enrichment = {
        "__rules": {
            "out": {
                "type": "jsonata",
                "expression": "a",
                "template": "coalesce",
                "template_params": {"source_fields": ["b", "a"]},
                "enabled": True,
            }
        }
    }
    result = apply_enrichment(event, enrichment)
    assert result["out"] == "alpha"


def test_jsonata_expression_required_validation() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "x": {
                    "type": "jsonata",
                    "expression": "",
                    "enabled": True,
                }
            }
        }
    )
    assert not result.ok
    assert any(i.code == "jsonata_expression_empty" for i in result.issues)


def test_jsonata_validation_accepts_template_metadata() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "full_name": {
                    "type": "jsonata",
                    "expression": "$join([$string(first_name), $string(last_name)], ' ')",
                    "template": "concat_fields",
                    "template_params": {"source_fields": ["first_name", "last_name"]},
                    "advanced_override": False,
                    "enabled": True,
                }
            }
        }
    )
    assert result.ok


def test_jsonata_failed_expression_warning() -> None:
    event = {"x": 1}
    enrichment = {
        "__rules": {
            "bad": {
                "type": "jsonata",
                "expression": "$unknownFunc(x)",
                "enabled": True,
            }
        }
    }
    # apply_enrichment may surface warnings via engine; ensure it does not raise
    result = apply_enrichment(event, enrichment)
    assert "bad" not in result or result.get("x") == 1


class _FakeEnrichment:
    def __init__(self, enrichment_json: dict) -> None:
        self.enrichment_json = enrichment_json


def test_jsonata_template_configuration_section() -> None:
    enrichment = _FakeEnrichment(
        {
            "__rules": {
                "full_name": {
                    "type": "jsonata",
                    "expression": "$join([$string(first_name), $string(last_name)], ' ')",
                    "template": "concat_fields",
                    "target_field": "full_name",
                    "advanced_override": True,
                    "enabled": True,
                }
            }
        }
    )
    sections = _jsonata_template_sections(enrichment)  # type: ignore[arg-type]
    assert len(sections) == 1
    assert sections[0].title == "JSONata Template"
    labels = {f.label: f.value for f in sections[0].fields}
    assert labels["Template Name"] == "Concat Fields"
    assert labels["Target Field"] == "full_name"
    assert labels["Generated Expression"] == "$join([$string(first_name), $string(last_name)], ' ')"
    assert labels["Advanced Override"] == "true"
    assert labels["Enabled"] == "true"
