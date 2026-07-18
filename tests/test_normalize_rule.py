"""Normalize enrichment rule — unit and integration tests."""

from __future__ import annotations

from app.enrichers.enrichment_engine import apply_enrichment, apply_enrichments_batch
from app.enrichers.normalize_rule import apply_normalize, normalize_operation
from app.enrichers.rule_validation import validate_enrichment_json


def test_trim() -> None:
    result = apply_normalize("  hello  ", operation="trim")
    assert result.value == "hello"


def test_lowercase() -> None:
    result = apply_normalize("ADMIN", operation="lowercase")
    assert result.value == "admin"


def test_uppercase() -> None:
    result = apply_normalize("admin", operation="uppercase")
    assert result.value == "ADMIN"


def test_remove_whitespace() -> None:
    result = apply_normalize("a b\tc\n", operation="remove_whitespace")
    assert result.value == "abc"


def test_replace_empty_with_null() -> None:
    assert apply_normalize("   ", operation="replace_empty_with_null").value is None
    assert apply_normalize("ok", operation="replace_empty_with_null").value == "ok"


def test_normalize_email() -> None:
    result = apply_normalize(" ADMIN@Company.COM ", operation="normalize_email")
    assert result.value == "admin@company.com"


def test_normalize_username() -> None:
    result = apply_normalize("DOMAIN\\user01", operation="normalize_username")
    assert result.value == "user01"


def test_normalize_username_from_email() -> None:
    result = apply_normalize("user@company.com", operation="normalize_username")
    assert result.value == "user"


def test_normalize_hostname() -> None:
    result = apply_normalize("host01.company.local", operation="normalize_hostname")
    assert result.value == "host01"


def test_extract_domain() -> None:
    result = apply_normalize("user@company.com", operation="extract_domain")
    assert result.value == "company.com"


def test_remove_domain() -> None:
    result = apply_normalize("user@company.com", operation="remove_domain")
    assert result.value == "user"


def test_legacy_iso8601() -> None:
    result = apply_normalize("2026-01-15T10:00:00Z", operation="iso8601")
    assert str(result.value).startswith("2026-01-15")


def test_on_failure_keep_original() -> None:
    result = apply_normalize("not-an-email", operation="normalize_email", on_failure="keep_original")
    assert result.value == "not-an-email"
    assert result.warning


def test_on_failure_set_null() -> None:
    result = apply_normalize("not-an-email", operation="normalize_email", on_failure="set_null")
    assert result.value is None
    assert result.warning


def test_on_failure_drop_field() -> None:
    result = apply_normalize("not-an-email", operation="extract_domain", on_failure="drop_field")
    assert result.dropped is True


def test_on_failure_skip_event() -> None:
    result = apply_normalize("not-an-email", operation="extract_domain", on_failure="skip_event")
    assert result.skipped is True


def test_enrichment_inplace_update() -> None:
    enrichment = {
        "__rules": {
            "email": {
                "type": "normalize",
                "source_field": "email",
                "operation": "normalize_email",
                "on_failure": "keep_original",
            }
        }
    }
    result = apply_enrichment({"email": " ADMIN@Company.COM "}, enrichment, override_policy="OVERRIDE")
    assert result["email"] == "admin@company.com"


def test_enrichment_different_target_field() -> None:
    enrichment = {
        "__rules": {
            "email_norm": {
                "type": "normalize",
                "source_field": "email",
                "operation": "normalize_email",
                "on_failure": "keep_original",
            }
        }
    }
    result = apply_enrichment({"email": " ADMIN@X.COM "}, enrichment, override_policy="OVERRIDE")
    assert result["email"] == " ADMIN@X.COM "
    assert result["email_norm"] == "admin@x.com"


def test_enrichment_legacy_format_field() -> None:
    enrichment = {
        "__rules": {
            "name": {
                "type": "normalize",
                "source_field": "name",
                "format": "lowercase",
                "enabled": True,
            }
        }
    }
    result = apply_enrichment({"name": "ADMIN"}, enrichment, override_policy="OVERRIDE")
    assert result["name"] == "admin"


def test_enrichment_skip_event() -> None:
    enrichment = {
        "__rules": {
            "domain": {
                "type": "normalize",
                "source_field": "email",
                "operation": "extract_domain",
                "on_failure": "skip_event",
            }
        }
    }
    batch = apply_enrichments_batch(
        [{"email": "not-an-email"}],
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
                    "type": "normalize",
                    "operation": "trim",
                }
            }
        }
    )
    assert any(i.code == "missing_source_field" for i in result.issues)


def test_validation_invalid_operation() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "metadata.ts": {
                    "type": "normalize",
                    "source_field": "created_at",
                    "operation": "unix_ms",
                    "enabled": True,
                }
            }
        }
    )
    assert not result.ok
    assert any(i.code == "invalid_normalize_operation" for i in result.issues)


def test_normalize_operation_aliases() -> None:
    assert normalize_operation("strip") == "trim"
    assert normalize_operation("lower") == "lowercase"
    assert normalize_operation("iso_8601") == "iso8601"
