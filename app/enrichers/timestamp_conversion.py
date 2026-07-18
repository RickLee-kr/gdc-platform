"""Timestamp Conversion transform for enrichment ``__rules``.

Converts Unix epoch / ISO8601 / RFC3339 values between formats with optional
timezone handling and failure policies. Also builds JSONata templates for the
Advanced UI (and optional ``expression_override`` evaluation).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

InputFormat = Literal[
    "unix_s",
    "unix_ms",
    "unix_us",
    "unix_ns",
    "iso8601",
    "rfc3339",
    "auto",
]
OutputFormat = Literal[
    "utc_iso8601",
    "unix_s",
    "unix_ms",
    "unix_us",
    "unix_ns",
    "rfc3339",
]
TimezoneMode = Literal["utc", "source", "custom"]
OnFailure = Literal["keep_original", "set_null", "drop_field", "skip_event"]

INPUT_FORMATS: frozenset[str] = frozenset(
    {"unix_s", "unix_ms", "unix_us", "unix_ns", "iso8601", "rfc3339", "auto"}
)
OUTPUT_FORMATS: frozenset[str] = frozenset(
    {"utc_iso8601", "unix_s", "unix_ms", "unix_us", "unix_ns", "rfc3339"}
)
TIMEZONE_MODES: frozenset[str] = frozenset({"utc", "source", "custom"})
ON_FAILURE_POLICIES: frozenset[str] = frozenset(
    {"keep_original", "set_null", "drop_field", "skip_event"}
)

# Approximate magnitude bands for auto-detect (absolute value).
_UNIX_S_MAX = 1e11  # ~ year 5138 in seconds
_UNIX_MS_MAX = 1e14
_UNIX_US_MAX = 1e17

_FIELD_REF_RE = re.compile(r"^[A-Za-z_@][A-Za-z0-9_@]*(\.[A-Za-z_@][A-Za-z0-9_@]*)*$")


class TimestampConversionError(ValueError):
    """Raised when a timestamp value cannot be converted."""


@dataclass(frozen=True, slots=True)
class TimestampConversionResult:
    value: Any
    skipped: bool = False
    dropped: bool = False
    warning: str | None = None


def normalize_input_format(raw: object) -> str:
    key = str(raw or "auto").strip().lower().replace("-", "_")
    aliases = {
        "unix_seconds": "unix_s",
        "unix_second": "unix_s",
        "seconds": "unix_s",
        "unix_milliseconds": "unix_ms",
        "unix_millisecond": "unix_ms",
        "milliseconds": "unix_ms",
        "ms": "unix_ms",
        "unix_microseconds": "unix_us",
        "unix_microsecond": "unix_us",
        "microseconds": "unix_us",
        "us": "unix_us",
        "unix_nanoseconds": "unix_ns",
        "unix_nanosecond": "unix_ns",
        "nanoseconds": "unix_ns",
        "ns": "unix_ns",
        "iso_8601": "iso8601",
        "iso": "iso8601",
        "rfc_3339": "rfc3339",
        "auto_detect": "auto",
    }
    key = aliases.get(key, key)
    if key not in INPUT_FORMATS:
        raise TimestampConversionError(f"Unsupported input_format {raw!r}")
    return key


def normalize_output_format(raw: object) -> str:
    key = str(raw or "utc_iso8601").strip().lower().replace("-", "_")
    aliases = {
        "utc": "utc_iso8601",
        "iso8601": "utc_iso8601",
        "iso_8601": "utc_iso8601",
        "unix_seconds": "unix_s",
        "seconds": "unix_s",
        "unix_milliseconds": "unix_ms",
        "milliseconds": "unix_ms",
        "ms": "unix_ms",
        "unix_microseconds": "unix_us",
        "microseconds": "unix_us",
        "us": "unix_us",
        "unix_nanoseconds": "unix_ns",
        "nanoseconds": "unix_ns",
        "ns": "unix_ns",
        "rfc_3339": "rfc3339",
    }
    key = aliases.get(key, key)
    if key not in OUTPUT_FORMATS:
        raise TimestampConversionError(f"Unsupported output_format {raw!r}")
    return key


def normalize_on_failure(raw: object) -> str:
    key = str(raw or "keep_original").strip().lower().replace("-", "_")
    aliases = {
        "keep": "keep_original",
        "null": "set_null",
        "drop": "drop_field",
        "skip": "skip_event",
    }
    key = aliases.get(key, key)
    if key not in ON_FAILURE_POLICIES:
        raise TimestampConversionError(f"Unsupported on_failure {raw!r}")
    return key


def parse_timezone_config(raw: object) -> tuple[str, str | None]:
    if raw is None:
        return "utc", None
    if isinstance(raw, str):
        mode = raw.strip().lower()
        if mode in TIMEZONE_MODES:
            return mode, None
        if mode:
            return "custom", mode
        return "utc", None
    if isinstance(raw, dict):
        mode = str(raw.get("mode") or "utc").strip().lower()
        iana = raw.get("iana") or raw.get("timezone") or raw.get("tz")
        iana_s = str(iana).strip() if iana is not None else None
        if mode not in TIMEZONE_MODES:
            raise TimestampConversionError(f"Unsupported timezone.mode {mode!r}")
        if mode == "custom" and not iana_s:
            raise TimestampConversionError("Custom timezone requires timezone.iana")
        return mode, iana_s or None
    raise TimestampConversionError(f"Invalid timezone config {type(raw).__name__}")


def _resolve_zone(mode: str, iana: str | None) -> timezone | ZoneInfo:
    if mode == "custom":
        if not iana:
            raise TimestampConversionError("Custom timezone requires an IANA name")
        try:
            return ZoneInfo(iana)
        except ZoneInfoNotFoundError as exc:
            raise TimestampConversionError(f"Unknown IANA timezone {iana!r}") from exc
    return UTC


def _to_float(raw: Any) -> float:
    if isinstance(raw, bool):
        raise TimestampConversionError("Boolean is not a valid timestamp")
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if not text:
        raise TimestampConversionError("Empty timestamp value")
    try:
        return float(text)
    except ValueError as exc:
        raise TimestampConversionError(f"Not a numeric timestamp: {raw!r}") from exc


def _from_epoch(seconds: float) -> datetime:
    try:
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise TimestampConversionError(f"Epoch out of range: {seconds}") from exc


def _parse_iso_like(raw: Any) -> datetime:
    """Parse ISO/RFC3339. Naive datetimes stay naive so timezone.mode can apply."""

    if isinstance(raw, datetime):
        return raw
    text = str(raw).strip()
    if not text:
        raise TimestampConversionError("Empty timestamp string")
    # Accept space separator and trailing Z.
    normalized = text.replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise TimestampConversionError(f"Invalid ISO/RFC3339 timestamp: {raw!r}") from exc


def _auto_detect_datetime(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, (int, float)) or (isinstance(raw, str) and re.fullmatch(r"[+-]?\d+(\.\d+)?", raw.strip())):
        n = abs(_to_float(raw))
        if n < _UNIX_S_MAX:
            return _from_epoch(_to_float(raw))
        if n < _UNIX_MS_MAX:
            return _from_epoch(_to_float(raw) / 1000.0)
        if n < _UNIX_US_MAX:
            return _from_epoch(_to_float(raw) / 1_000_000.0)
        return _from_epoch(_to_float(raw) / 1_000_000_000.0)
    return _parse_iso_like(raw)


def parse_to_datetime(
    raw: Any,
    *,
    input_format: str,
    timezone_mode: str = "utc",
    timezone_iana: str | None = None,
) -> datetime:
    fmt = normalize_input_format(input_format)
    if fmt == "unix_s":
        dt = _from_epoch(_to_float(raw))
    elif fmt == "unix_ms":
        dt = _from_epoch(_to_float(raw) / 1000.0)
    elif fmt == "unix_us":
        dt = _from_epoch(_to_float(raw) / 1_000_000.0)
    elif fmt == "unix_ns":
        dt = _from_epoch(_to_float(raw) / 1_000_000_000.0)
    elif fmt in {"iso8601", "rfc3339"}:
        dt = _parse_iso_like(raw)
    else:
        dt = _auto_detect_datetime(raw)

    if timezone_mode == "utc":
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    if timezone_mode == "source":
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt

    # custom: interpret naive as custom zone; aware values convert to UTC as-is
    zone = _resolve_zone("custom", timezone_iana)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zone)
    return dt.astimezone(UTC)


def format_datetime(dt: datetime, *, output_format: str) -> Any:
    fmt = normalize_output_format(output_format)
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    utc_dt = aware.astimezone(UTC)
    if fmt == "utc_iso8601":
        return utc_dt.isoformat().replace("+00:00", "Z")
    if fmt == "rfc3339":
        # RFC3339 with Z for UTC
        return utc_dt.isoformat().replace("+00:00", "Z")
    epoch = utc_dt.timestamp()
    if fmt == "unix_s":
        return int(epoch) if epoch == int(epoch) else epoch
    if fmt == "unix_ms":
        return int(round(epoch * 1000))
    if fmt == "unix_us":
        return int(round(epoch * 1_000_000))
    if fmt == "unix_ns":
        return int(round(epoch * 1_000_000_000))
    raise TimestampConversionError(f"Unsupported output_format {output_format!r}")


def convert_timestamp(
    raw: Any,
    *,
    input_format: str = "auto",
    output_format: str = "utc_iso8601",
    timezone: object = "utc",
    on_failure: str = "keep_original",
) -> TimestampConversionResult:
    failure = normalize_on_failure(on_failure)
    try:
        tz_mode, tz_iana = parse_timezone_config(timezone)
        dt = parse_to_datetime(
            raw,
            input_format=input_format,
            timezone_mode=tz_mode,
            timezone_iana=tz_iana,
        )
        value = format_datetime(dt, output_format=output_format)
        return TimestampConversionResult(value=value)
    except TimestampConversionError as exc:
        if failure == "keep_original":
            return TimestampConversionResult(value=raw, warning=str(exc))
        if failure == "set_null":
            return TimestampConversionResult(value=None, warning=str(exc))
        if failure == "drop_field":
            return TimestampConversionResult(value=None, dropped=True, warning=str(exc))
        if failure == "skip_event":
            return TimestampConversionResult(value=None, skipped=True, warning=str(exc))
        raise


def _jsonata_field_ref(path: str) -> str:
    key = path.strip()
    if not key:
        return "null"
    parts = key.split(".")
    out = parts[0]
    for part in parts[1:]:
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", part):
            out = f"{out}.{part}"
        else:
            out = f'{out}."{part}"'
    if key.startswith("@") or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", parts[0]):
        # Top-level unusual keys: use backtick-style via $lookup if needed
        if "." not in key:
            return f'$lookup($, "{key}")'
    return out


def build_jsonata_template(
    *,
    source_field: str,
    input_format: str = "auto",
    output_format: str = "utc_iso8601",
) -> str:
    """Return a human-editable JSONata expression approximating the conversion."""

    src = _jsonata_field_ref(source_field)
    inp = normalize_input_format(input_format)
    out = normalize_output_format(output_format)

    if inp == "unix_s":
        millis_expr = f"$number({src}) * 1000"
    elif inp == "unix_ms":
        millis_expr = f"$number({src})"
    elif inp == "unix_us":
        millis_expr = f"$number({src}) / 1000"
    elif inp == "unix_ns":
        millis_expr = f"$number({src}) / 1000000"
    elif inp in {"iso8601", "rfc3339"}:
        millis_expr = f"$toMillis({src})"
    else:
        millis_expr = (
            f"($n := $number({src}); "
            f"$n < 1e11 ? $n * 1000 : $n < 1e14 ? $n : $n < 1e17 ? $n / 1000 : $n / 1000000)"
        )

    if out == "utc_iso8601" or out == "rfc3339":
        return f"$fromMillis({millis_expr})"
    if out == "unix_s":
        return f"$floor(({millis_expr}) / 1000)"
    if out == "unix_ms":
        return f"$floor({millis_expr})"
    if out == "unix_us":
        return f"$floor(({millis_expr}) * 1000)"
    if out == "unix_ns":
        return f"$floor(({millis_expr}) * 1000000)"
    return f"$fromMillis({millis_expr})"


def evaluate_jsonata_expression(expression: str, event: dict[str, Any]) -> Any:
    text = expression.strip()
    if not text:
        raise TimestampConversionError("Empty JSONata expression_override")
    try:
        import jsonata  # type: ignore[import-untyped]
    except ImportError as exc:
        raise TimestampConversionError(
            "JSONata engine is not installed; add jsonata-python to the runtime environment."
        ) from exc
    try:
        evaluator = jsonata.Jsonata(text)
        return evaluator.evaluate(event)
    except Exception as exc:  # noqa: BLE001
        raise TimestampConversionError(f"JSONata evaluation failed: {exc}") from exc


def rule_formats_equivalent(input_format: str, output_format: str) -> bool:
    """True when conversion is a no-op identity (same semantic format)."""

    try:
        inp = normalize_input_format(input_format)
        out = normalize_output_format(output_format)
    except TimestampConversionError:
        return False
    if inp == "auto":
        return False
    pairs = {
        ("iso8601", "utc_iso8601"),
        ("iso8601", "rfc3339"),
        ("rfc3339", "utc_iso8601"),
        ("rfc3339", "rfc3339"),
        ("unix_s", "unix_s"),
        ("unix_ms", "unix_ms"),
        ("unix_us", "unix_us"),
        ("unix_ns", "unix_ns"),
    }
    return (inp, out) in pairs


def is_timestamp_field_path(path: str) -> bool:
    """Allow ``@timestamp`` and normal enrichment field paths."""

    key = path.strip()
    if not key or key.startswith("__"):
        return False
    if ".." in key or key.endswith("."):
        return False
    return bool(_FIELD_REF_RE.match(key))


__all__ = [
    "INPUT_FORMATS",
    "OUTPUT_FORMATS",
    "ON_FAILURE_POLICIES",
    "TIMEZONE_MODES",
    "TimestampConversionError",
    "TimestampConversionResult",
    "build_jsonata_template",
    "convert_timestamp",
    "evaluate_jsonata_expression",
    "format_datetime",
    "is_timestamp_field_path",
    "normalize_input_format",
    "normalize_on_failure",
    "normalize_output_format",
    "parse_timezone_config",
    "parse_to_datetime",
    "rule_formats_equivalent",
]
