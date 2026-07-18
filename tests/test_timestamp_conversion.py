"""Timestamp Conversion transform — unit and enrichment integration tests."""

from __future__ import annotations

from app.enrichers.enrichment_engine import apply_enrichment, apply_enrichments_batch
from app.enrichers.rule_validation import validate_enrichment_json
from app.enrichers.timestamp_conversion import (
    build_jsonata_template,
    convert_timestamp,
    format_datetime,
    parse_to_datetime,
    rule_formats_equivalent,
)

# Fixed reference: 2025-07-07T09:20:00.123Z
_EPOCH_S = 1_751_880_000
_EPOCH_MS = 1_751_880_000_123
_EPOCH_US = 1_751_880_000_123_000
_EPOCH_NS = 1_751_880_000_123_000_000
_ISO_MS = "2025-07-07T09:20:00.123000Z"
_ISO = "2025-07-07T09:20:00Z"


def test_unix_seconds_to_utc_iso8601() -> None:
    result = convert_timestamp(_EPOCH_S, input_format="unix_s", output_format="utc_iso8601")
    assert result.value == _ISO
    assert not result.skipped


def test_unix_milliseconds_to_utc_iso8601() -> None:
    result = convert_timestamp(_EPOCH_MS, input_format="unix_ms", output_format="utc_iso8601")
    assert str(result.value).startswith("2025-07-07T09:20:00.123")
    assert str(result.value).endswith("Z")


def test_unix_microseconds_to_utc_iso8601() -> None:
    result = convert_timestamp(_EPOCH_US, input_format="unix_us", output_format="utc_iso8601")
    assert str(result.value).startswith("2025-07-07T09:20:00.123")


def test_unix_nanoseconds_to_utc_iso8601() -> None:
    result = convert_timestamp(_EPOCH_NS, input_format="unix_ns", output_format="utc_iso8601")
    assert str(result.value).startswith("2025-07-07T09:20:00.123")


def test_utc_iso8601_to_unix_milliseconds() -> None:
    result = convert_timestamp(
        _ISO_MS,
        input_format="iso8601",
        output_format="unix_ms",
    )
    assert result.value == _EPOCH_MS


def test_auto_detect_numeric_ms() -> None:
    result = convert_timestamp(_EPOCH_MS, input_format="auto", output_format="utc_iso8601")
    assert str(result.value).startswith("2025-07-07T09:20:00.123")


def test_auto_detect_iso_string() -> None:
    result = convert_timestamp(_ISO, input_format="auto", output_format="unix_s")
    assert result.value == _EPOCH_S


def test_timezone_custom_naive_local() -> None:
    # Naive local Asia/Seoul (UTC+9) → UTC
    result = convert_timestamp(
        "2025-07-07T18:20:00",
        input_format="iso8601",
        output_format="utc_iso8601",
        timezone={"mode": "custom", "iana": "Asia/Seoul"},
    )
    assert result.value == _ISO


def test_on_failure_keep_original() -> None:
    result = convert_timestamp(
        "not-a-timestamp",
        input_format="iso8601",
        output_format="utc_iso8601",
        on_failure="keep_original",
    )
    assert result.value == "not-a-timestamp"
    assert result.warning


def test_on_failure_set_null() -> None:
    result = convert_timestamp("bad", input_format="iso8601", on_failure="set_null")
    assert result.value is None
    assert result.warning


def test_on_failure_drop_field() -> None:
    result = convert_timestamp("bad", input_format="iso8601", on_failure="drop_field")
    assert result.dropped is True


def test_on_failure_skip_event() -> None:
    result = convert_timestamp("bad", input_format="iso8601", on_failure="skip_event")
    assert result.skipped is True


def test_enrichment_rule_unix_ms_to_at_timestamp() -> None:
    enrichment = {
        "__rules": {
            "@timestamp": {
                "type": "timestamp_conversion",
                "source_field": "event_time",
                "input_format": "unix_ms",
                "output_format": "utc_iso8601",
                "timezone": {"mode": "utc"},
                "on_failure": "keep_original",
                "enabled": True,
            }
        }
    }
    out = apply_enrichment({"event_time": _EPOCH_MS}, enrichment, override_policy="OVERRIDE")
    assert str(out["@timestamp"]).startswith("2025-07-07T09:20:00.123")


def test_enrichment_skip_event_removes_from_batch() -> None:
    enrichment = {
        "__rules": {
            "@timestamp": {
                "type": "timestamp_conversion",
                "source_field": "event_time",
                "input_format": "iso8601",
                "output_format": "utc_iso8601",
                "on_failure": "skip_event",
                "enabled": True,
            }
        }
    }
    batch = apply_enrichments_batch(
        [
            {"event_time": _ISO, "id": "ok"},
            {"event_time": "bad", "id": "bad"},
        ],
        enrichment,
        override_policy="OVERRIDE",
    )
    assert len(batch.events) == 1
    assert batch.events[0]["id"] == "ok"
    assert batch.skipped_count == 1


def test_validation_requires_source_and_target() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "": {
                    "type": "timestamp_conversion",
                    "source_field": "",
                    "input_format": "unix_ms",
                    "output_format": "utc_iso8601",
                }
            }
        }
    )
    codes = {i.code for i in result.issues}
    assert "missing_source_field" in codes or "missing_target_field" in codes


def test_validation_same_format_warning() -> None:
    result = validate_enrichment_json(
        {
            "__rules": {
                "event_time": {
                    "type": "timestamp_conversion",
                    "source_field": "event_time",
                    "input_format": "unix_ms",
                    "output_format": "unix_ms",
                    "enabled": True,
                }
            }
        }
    )
    assert any(i.code == "timestamp_formats_identical" for i in result.issues)


def test_jsonata_template_unix_ms_to_utc() -> None:
    expr = build_jsonata_template(
        source_field="event_time",
        input_format="unix_ms",
        output_format="utc_iso8601",
    )
    assert "$fromMillis" in expr
    assert "event_time" in expr


def test_rule_formats_equivalent() -> None:
    assert rule_formats_equivalent("unix_ms", "unix_ms")
    assert not rule_formats_equivalent("unix_ms", "utc_iso8601")
    assert not rule_formats_equivalent("auto", "utc_iso8601")


def test_parse_rfc3339() -> None:
    dt = parse_to_datetime("2025-07-07T09:20:00+00:00", input_format="rfc3339")
    assert format_datetime(dt, output_format="unix_s") == _EPOCH_S
