"""Advanced enrichment rule execution (static + calculated/lookup/conditional/normalize)."""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.enrichers.expression_evaluator import ExpressionEvaluationError, evaluate_calculated_expression
from app.runtime.copy_utils import copy_event_dict, copy_json_value
from app.enrichers.field_paths import get_field_value, has_field_value, is_valid_field_path, set_field_value
from app.enrichers.lookup_tables import lookup_value
from app.enrichers.payload_safety import sanitize_delivery_event
from app.enrichers.normalize_rule import (
    NormalizeRuleError,
    apply_normalize,
    is_normalize_field_path,
    resolve_normalize_operation,
)
from app.enrichers.timestamp_conversion import (
    TimestampConversionError,
    convert_timestamp,
    evaluate_jsonata_expression,
    is_timestamp_field_path,
)
from app.enrichers.type_conversion import (
    TypeConversionError,
    convert_type,
    is_type_conversion_field_path,
)
from app.runtime.errors import EnrichmentError

logger = logging.getLogger(__name__)

_OVERRIDE_KEEP_EXISTING = "KEEP_EXISTING"
_OVERRIDE_FORCE = "OVERRIDE"
_OVERRIDE_ERROR = "ERROR_ON_CONFLICT"

_RESERVED_KEYS = frozenset({"__rules", "__computed"})

_RULE_TYPES = frozenset(
    {
        "static",
        "calculated",
        "lookup",
        "conditional",
        "normalize",
        "timestamp_conversion",
        "type_conversion",
        "jsonata",
    }
)


@dataclass
class EnrichmentWarning:
    code: str
    message: str
    rule_type: str | None = None
    target_field: str | None = None

    def to_log_dict(self) -> dict[str, Any]:
        return {
            "stage": "enrichment",
            "code": self.code,
            "message": self.message,
            "rule_type": self.rule_type,
            "target_field": self.target_field,
        }


@dataclass(frozen=True, slots=True)
class EnrichmentFieldError:
    """Field-level enrichment transform failure for runtime delivery_logs."""

    rule_id: str | None
    output_field: str
    error_code: str
    error_message: str
    sample_value: str | None = None

    def to_delivery_log_fields(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "output_field": self.output_field,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "sample_value": self.sample_value,
        }


@dataclass
class EnrichmentExecutionResult:
    event: dict[str, Any]
    warnings: list[EnrichmentWarning] = field(default_factory=list)
    duration_ms: int = 0
    skipped: bool = False


@dataclass
class EnrichmentBatchResult:
    events: list[dict[str, Any]]
    warnings: list[EnrichmentWarning] = field(default_factory=list)
    field_errors: list[EnrichmentFieldError] = field(default_factory=list)
    duration_ms: int = 0
    warning_count: int = 0
    skipped_count: int = 0


def _log_warning(warning: EnrichmentWarning) -> None:
    logger.warning("%s", warning.to_log_dict())


def _dedupe_warnings(warnings: list[EnrichmentWarning]) -> list[EnrichmentWarning]:
    seen: set[tuple[str, str | None, str]] = set()
    out: list[EnrichmentWarning] = []
    for w in warnings:
        key = (w.code, w.target_field, w.message)
        if key in seen:
            continue
        seen.add(key)
        out.append(w)
    return out


def _emit_batch_warnings(warnings: list[EnrichmentWarning]) -> None:
    for w in _dedupe_warnings(warnings):
        _log_warning(w)


def _validate_policy(policy: str) -> str:
    allowed = {_OVERRIDE_KEEP_EXISTING, _OVERRIDE_FORCE, _OVERRIDE_ERROR}
    if policy not in allowed:
        raise EnrichmentError(
            f"Unknown override_policy {policy!r}; expected one of {sorted(allowed)}"
        )
    return policy


def _is_json_like(value: Any) -> bool:
    if value is None or isinstance(value, bool | int | float | str):
        return True
    if isinstance(value, dict):
        return all(isinstance(k, str) and _is_json_like(v) for k, v in value.items())
    if isinstance(value, list):
        return all(_is_json_like(item) for item in value)
    return False


def _resolve_static_template(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip().replace(" ", "").lower()
    if normalized == "{{now_utc}}":
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return value


def _normalize_rule_dict(
    rule: dict[str, Any],
    *,
    default_target: str | None = None,
) -> dict[str, Any] | None:
    rule_type = str(rule.get("type") or "").strip().lower()
    if rule_type not in _RULE_TYPES:
        return None
    target = str(
        rule.get("target_field")
        or rule.get("fieldName")
        or rule.get("field_name")
        or default_target
        or ""
    ).strip()
    if not target:
        return None
    if rule.get("enabled") is False:
        return None
    out = dict(rule)
    out["type"] = rule_type
    out["target_field"] = target
    return out


def _iter_advanced_rules(enrichment: dict[str, Any]) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []

    raw_rules = enrichment.get("__rules")
    if isinstance(raw_rules, dict):
        for key, value in raw_rules.items():
            key_type = str(key).strip().lower()
            if isinstance(value, dict) and "type" in value:
                normalized = _normalize_rule_dict(value, default_target=str(key))
                if normalized:
                    rules.append(normalized)
            elif isinstance(value, list):
                for item in value:
                    if not isinstance(item, dict):
                        continue
                    merged = dict(item)
                    if key_type in _RULE_TYPES and "type" not in merged:
                        merged["type"] = key_type
                    normalized = _normalize_rule_dict(merged)
                    if normalized:
                        rules.append(normalized)

    raw_computed = enrichment.get("__computed")
    if isinstance(raw_computed, dict):
        for key, value in raw_computed.items():
            if not isinstance(value, dict):
                continue
            expr = value.get("expression")
            if not isinstance(expr, str):
                continue
            rules.append(
                {
                    "type": "calculated",
                    "target_field": str(key),
                    "expression": expr,
                    "enabled": True,
                }
            )

    return rules


def _split_static_fields(enrichment: dict[str, Any]) -> dict[str, Any]:
    static: dict[str, Any] = {}
    for key, value in enrichment.items():
        if key in _RESERVED_KEYS:
            continue
        if isinstance(value, dict) and "type" in value:
            continue
        static[key] = _resolve_static_template(value)
    return static


def _should_apply(target: str, event: dict[str, Any], policy: str) -> bool:
    if policy == _OVERRIDE_FORCE:
        return True
    if has_field_value(event, target):
        if policy == _OVERRIDE_ERROR:
            raise EnrichmentError(
                f"Enrichment field {target!r} conflicts with existing event field "
                f"(override_policy={policy})"
            )
        return False
    return True


def _apply_static_fields(
    event: dict[str, Any],
    static_fields: dict[str, Any],
    policy: str,
) -> dict[str, Any]:
    base = copy_event_dict(event)
    for key, value in static_fields.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if not _is_json_like(value):
            raise EnrichmentError(
                f"Enrichment value for field {key!r} must be JSON-like; got {type(value).__name__}"
            )
        target = key.strip()
        if not _should_apply(target, base, policy):
            continue
        if not is_valid_field_path(target):
            continue
        if "." in target:
            set_field_value(base, target, value)
        else:
            base[target] = copy_json_value(value)
    return base


def _parse_condition(when: str) -> tuple[str, str, str] | None:
    """Return ``(operator, field, operand)``."""

    text = when.strip()
    if not text:
        return None
    lower = text.lower()
    if lower.startswith("exists "):
        return ("exists", text[7:].strip(), "")
    if " contains " in lower:
        field, _, operand = text.partition(" contains ")
        return ("contains", field.strip(), operand.strip().strip("'\""))
    m = re.match(r"^(.+?)\s*===\s*['\"]([^'\"]*)['\"]\s*$", text)
    if m:
        return ("equals", m.group(1).strip(), m.group(2))
    m = re.match(r"^(.+?)\s*!==\s*['\"]([^'\"]*)['\"]\s*$", text)
    if m:
        return ("not_equals", m.group(1).strip(), m.group(2))
    m = re.match(r"^(.+?)\s*==\s*['\"]?([^'\"]+)['\"]?\s*$", text)
    if m:
        return ("equals", m.group(1).strip(), m.group(2))
    m = re.match(r"^(.+?)\s*!=\s*['\"]?([^'\"]+)['\"]?\s*$", text)
    if m:
        return ("not_equals", m.group(1).strip(), m.group(2))
    m = re.match(
        r"^([A-Za-z_][A-Za-z0-9_.]*)\s*\.includes\s*\(\s*['\"]([^'\"]*)['\"]\s*\)\s*$",
        text,
    )
    if m:
        return ("contains", m.group(1), m.group(2))
    return None


def _evaluate_condition(when: str, event: dict[str, Any]) -> bool:
    parsed = _parse_condition(when)
    if parsed is None:
        return False
    op, field, operand = parsed
    val = get_field_value(event, field)
    if val is None:
        val = event.get(field)
    if op == "exists":
        return val is not None and str(val) != ""
    if op == "equals":
        return str(val) == operand
    if op == "not_equals":
        return str(val) != operand
    if op == "contains":
        return operand in str(val or "")
    return False


def _apply_calculated(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    expression = str(rule.get("expression") or "")
    if not _should_apply(target, event, policy):
        return
    try:
        value = evaluate_calculated_expression(expression, event)
    except ExpressionEvaluationError as exc:
        warning = EnrichmentWarning(
            code="calculated_expression_failed",
            message=str(exc),
            rule_type="calculated",
            target_field=target,
        )
        warnings.append(warning)
        return
    if not set_field_value(event, target, value):
        warnings.append(
            EnrichmentWarning(
                code="invalid_field_path",
                message=f"Could not write calculated field {target!r}",
                rule_type="calculated",
                target_field=target,
            )
        )
        return


def _apply_lookup(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    table = str(rule.get("lookup_table") or rule.get("lookupTable") or "")
    key_field = str(
        rule.get("key_field")
        or rule.get("lookup_key_field")
        or rule.get("lookupKeyField")
        or ""
    ).strip()
    if not table or not key_field:
        warning = EnrichmentWarning(
            code="invalid_rule_definition",
            message="Lookup rule requires lookup_table and key_field",
            rule_type="lookup",
            target_field=target,
        )
        warnings.append(warning)
        return
    if not _should_apply(target, event, policy):
        return
    raw_key = get_field_value(event, key_field)
    if raw_key is None:
        raw_key = event.get(key_field)
    if raw_key is None or str(raw_key).strip() == "":
        warning = EnrichmentWarning(
            code="lookup_key_missing",
            message=f"Lookup key field {key_field!r} is missing on event",
            rule_type="lookup",
            target_field=target,
        )
        warnings.append(warning)
        return
    resolved = lookup_value(table, str(raw_key))
    if resolved is None:
        warning = EnrichmentWarning(
            code="lookup_miss",
            message=f"No lookup value for key {raw_key!r} in table {table!r}",
            rule_type="lookup",
            target_field=target,
        )
        warnings.append(warning)
        return
    set_field_value(event, target, resolved)


def _apply_conditional(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    if not _should_apply(target, event, policy):
        return
    conditions = rule.get("conditions")
    if not isinstance(conditions, list):
        warning = EnrichmentWarning(
            code="conditional_invalid",
            message="Conditional rule requires conditions list",
            rule_type="conditional",
            target_field=target,
        )
        warnings.append(warning)
        return
    value: Any = rule.get("default") or rule.get("conditionalDefault") or ""
    matched = False
    for item in conditions:
        if not isinstance(item, dict):
            continue
        when = str(item.get("when") or "")
        if when and _evaluate_condition(when, event):
            value = item.get("then", "")
            matched = True
            break
        if when.strip() and not _parse_condition(when):
            warnings.append(
                EnrichmentWarning(
                    code="conditional_invalid",
                    message=f"Unrecognized condition syntax: {when!r}",
                    rule_type="conditional",
                    target_field=target,
                )
            )
    if not matched and not str(value).strip():
        warnings.append(
            EnrichmentWarning(
                code="conditional_invalid",
                message="No condition matched and default is empty",
                rule_type="conditional",
                target_field=target,
            )
        )
    set_field_value(event, target, value)


class _SkipEnrichmentEvent(Exception):
    """Internal signal: drop this event from the enrichment batch (skip_event policy)."""

    def __init__(self, warning: EnrichmentWarning) -> None:
        super().__init__(warning.message)
        self.warning = warning


def _delete_field_value(event: dict[str, Any], path: str) -> None:
    key = path.strip()
    if not key:
        return
    if "." not in key:
        event.pop(key, None)
        return
    parts = key.split(".")
    cur: Any = event
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return
        cur = cur[part]
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)


def _apply_timestamp_conversion(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    source = str(
        rule.get("source_field")
        or rule.get("tsSourceField")
        or rule.get("sourceField")
        or ""
    ).strip()
    if not source:
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message="Timestamp conversion requires source_field",
                rule_type="timestamp_conversion",
                target_field=target,
            )
        )
        return
    if not (is_timestamp_field_path(target) or is_valid_field_path(target)):
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message=f"Invalid target field path {target!r}",
                rule_type="timestamp_conversion",
                target_field=target,
            )
        )
        return
    if not _should_apply(target, event, policy):
        return

    override = str(
        rule.get("expression_override")
        or rule.get("jsonata_override")
        or rule.get("tsExpressionOverride")
        or ""
    ).strip()
    on_failure = str(rule.get("on_failure") or rule.get("tsOnFailure") or "keep_original")
    input_format = str(rule.get("input_format") or rule.get("tsInputFormat") or "auto")
    output_format = str(rule.get("output_format") or rule.get("tsOutputFormat") or "utc_iso8601")
    timezone_cfg: Any = rule.get("timezone")
    if timezone_cfg is None:
        mode = str(rule.get("tsTimezoneMode") or "utc").strip().lower()
        custom = str(rule.get("tsCustomTimezone") or "").strip()
        timezone_cfg = {"mode": mode, "iana": custom} if mode == "custom" else {"mode": mode}

    raw = get_field_value(event, source)
    if raw is None:
        raw = event.get(source)

    try:
        if override:
            value = evaluate_jsonata_expression(override, event)
            set_field_value(event, target, value)
            return

        result = convert_timestamp(
            raw,
            input_format=input_format,
            output_format=output_format,
            timezone=timezone_cfg,
            on_failure=on_failure,
        )
    except TimestampConversionError as exc:
        warnings.append(
            EnrichmentWarning(
                code="timestamp_conversion_failed",
                message=str(exc),
                rule_type="timestamp_conversion",
                target_field=target,
            )
        )
        return

    if result.warning:
        warnings.append(
            EnrichmentWarning(
                code="timestamp_conversion_failed",
                message=result.warning,
                rule_type="timestamp_conversion",
                target_field=target,
            )
        )
    if result.skipped:
        raise _SkipEnrichmentEvent(
            EnrichmentWarning(
                code="timestamp_conversion_skipped_event",
                message=result.warning or "Timestamp conversion failed; event skipped",
                rule_type="timestamp_conversion",
                target_field=target,
            )
        )
    if result.dropped:
        _delete_field_value(event, target)
        return
    set_field_value(event, target, result.value)


def _apply_type_conversion(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    source = str(
        rule.get("source_field")
        or rule.get("tcSourceField")
        or rule.get("sourceField")
        or ""
    ).strip()
    if not source:
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message="Type conversion requires source_field",
                rule_type="type_conversion",
                target_field=target,
            )
        )
        return
    if not (is_type_conversion_field_path(target) or is_valid_field_path(target)):
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message=f"Invalid target field path {target!r}",
                rule_type="type_conversion",
                target_field=target,
            )
        )
        return
    if not _should_apply(target, event, policy):
        return

    target_type = str(rule.get("target_type") or rule.get("tcTargetType") or "")
    on_failure = str(rule.get("on_failure") or rule.get("tcOnFailure") or "keep_original")

    raw = get_field_value(event, source)
    if raw is None:
        raw = event.get(source)

    try:
        result = convert_type(raw, target_type=target_type, on_failure=on_failure)
    except TypeConversionError as exc:
        warnings.append(
            EnrichmentWarning(
                code="type_conversion_failed",
                message=str(exc),
                rule_type="type_conversion",
                target_field=target,
            )
        )
        return

    if result.warning:
        warnings.append(
            EnrichmentWarning(
                code="type_conversion_failed",
                message=result.warning,
                rule_type="type_conversion",
                target_field=target,
            )
        )
    if result.skipped:
        raise _SkipEnrichmentEvent(
            EnrichmentWarning(
                code="type_conversion_skipped_event",
                message=result.warning or "Type conversion failed; event skipped",
                rule_type="type_conversion",
                target_field=target,
            )
        )
    if result.dropped:
        _delete_field_value(event, target)
        return
    set_field_value(event, target, result.value)


def _apply_normalize(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    target = str(rule["target_field"])
    source = str(
        rule.get("source_field")
        or rule.get("normalizeSourceField")
        or rule.get("sourceField")
        or ""
    ).strip()
    if not source:
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message="Normalize rule requires source_field",
                rule_type="normalize",
                target_field=target,
            )
        )
        return
    if not (is_normalize_field_path(target) or is_valid_field_path(target)):
        warnings.append(
            EnrichmentWarning(
                code="invalid_rule_definition",
                message=f"Invalid target field path {target!r}",
                rule_type="normalize",
                target_field=target,
            )
        )
        return
    if not _should_apply(target, event, policy):
        return

    try:
        operation = resolve_normalize_operation(rule)
    except NormalizeRuleError as exc:
        warnings.append(
            EnrichmentWarning(
                code="normalize_failed",
                message=str(exc),
                rule_type="normalize",
                target_field=target,
            )
        )
        return

    on_failure = str(
        rule.get("on_failure") or rule.get("normalizeOnFailure") or "keep_original"
    )

    raw = get_field_value(event, source)
    if raw is None:
        raw = event.get(source)

    try:
        result = apply_normalize(raw, operation=operation, on_failure=on_failure)
    except NormalizeRuleError as exc:
        warnings.append(
            EnrichmentWarning(
                code="normalize_failed",
                message=str(exc),
                rule_type="normalize",
                target_field=target,
            )
        )
        return

    if result.warning:
        warnings.append(
            EnrichmentWarning(
                code="normalize_failed",
                message=result.warning,
                rule_type="normalize",
                target_field=target,
            )
        )
    if result.skipped:
        raise _SkipEnrichmentEvent(
            EnrichmentWarning(
                code="normalize_skipped_event",
                message=result.warning or "Normalize failed; event skipped",
                rule_type="normalize",
                target_field=target,
            )
        )
    if result.dropped:
        _delete_field_value(event, target)
        return
    set_field_value(event, target, result.value)


def _apply_jsonata(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    """Evaluate a stored JSONata expression (template metadata is ignored at runtime)."""

    target = str(rule["target_field"])
    expression = str(rule.get("expression") or "").strip()
    if not expression:
        warnings.append(
            EnrichmentWarning(
                code="jsonata_expression_empty",
                message="JSONata expression is required",
                rule_type="jsonata",
                target_field=target,
            )
        )
        return
    if not (is_valid_field_path(target) or is_timestamp_field_path(target)):
        warnings.append(
            EnrichmentWarning(
                code="invalid_field_path",
                message=f"Could not write jsonata field {target!r}",
                rule_type="jsonata",
                target_field=target,
            )
        )
        return
    if not _should_apply(target, event, policy):
        return
    try:
        value = evaluate_jsonata_expression(expression, event)
    except TimestampConversionError as exc:
        warnings.append(
            EnrichmentWarning(
                code="jsonata_expression_failed",
                message=str(exc),
                rule_type="jsonata",
                target_field=target,
            )
        )
        return
    if not set_field_value(event, target, value):
        warnings.append(
            EnrichmentWarning(
                code="invalid_field_path",
                message=f"Could not write jsonata field {target!r}",
                rule_type="jsonata",
                target_field=target,
            )
        )


def _apply_advanced_rule(
    event: dict[str, Any],
    rule: dict[str, Any],
    policy: str,
    warnings: list[EnrichmentWarning],
) -> None:
    rule_type = str(rule.get("type") or "")
    if rule_type == "calculated":
        _apply_calculated(event, rule, policy, warnings)
    elif rule_type == "lookup":
        _apply_lookup(event, rule, policy, warnings)
    elif rule_type == "conditional":
        _apply_conditional(event, rule, policy, warnings)
    elif rule_type == "normalize":
        _apply_normalize(event, rule, policy, warnings)
    elif rule_type == "timestamp_conversion":
        _apply_timestamp_conversion(event, rule, policy, warnings)
    elif rule_type == "type_conversion":
        _apply_type_conversion(event, rule, policy, warnings)
    elif rule_type == "jsonata":
        _apply_jsonata(event, rule, policy, warnings)
    else:
        warning = EnrichmentWarning(
            code="invalid_rule_definition",
            message=f"Unsupported rule type {rule_type!r}",
            rule_type=rule_type,
            target_field=str(rule.get("target_field") or ""),
        )
        warnings.append(warning)


def execute_enrichment(
    event: dict[str, Any],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
    *,
    emit_logs: bool = True,
) -> EnrichmentExecutionResult:
    """Apply static fields and advanced rules; never inject ``__rules`` into output."""

    started = time.monotonic()
    policy = _validate_policy(override_policy)
    if not isinstance(event, dict):
        raise EnrichmentError(f"execute_enrichment expects dict event, got {type(event).__name__}")
    if not enrichment:
        safe = sanitize_delivery_event(copy_event_dict(event))
        return EnrichmentExecutionResult(
            event=safe,
            duration_ms=max(0, int((time.monotonic() - started) * 1000)),
        )

    warnings: list[EnrichmentWarning] = []
    static_fields = _split_static_fields(enrichment)
    advanced_rules = _iter_advanced_rules(enrichment)

    try:
        result_event = _apply_static_fields(event, static_fields, policy)
    except EnrichmentError:
        raise

    for rule in advanced_rules:
        try:
            _apply_advanced_rule(result_event, rule, policy, warnings)
        except _SkipEnrichmentEvent as skip:
            warnings.append(skip.warning)
            duration_ms = max(0, int((time.monotonic() - started) * 1000))
            if emit_logs:
                for w in warnings:
                    _log_warning(w)
            return EnrichmentExecutionResult(
                event=sanitize_delivery_event(result_event),
                warnings=warnings,
                duration_ms=duration_ms,
                skipped=True,
            )
        except EnrichmentError:
            raise

    safe_event = sanitize_delivery_event(result_event)
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    if emit_logs:
        for w in warnings:
            _log_warning(w)
    return EnrichmentExecutionResult(event=safe_event, warnings=warnings, duration_ms=duration_ms)


def execute_enrichments(
    events: list[dict[str, Any]],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> list[dict[str, Any]]:
    """Apply :func:`execute_enrichment` to each event (batch warnings logged once)."""

    return execute_enrichments_batch(events, enrichment, override_policy=override_policy).events


def execute_enrichments_batch(
    events: list[dict[str, Any]],
    enrichment: dict[str, Any],
    override_policy: str = _OVERRIDE_KEEP_EXISTING,
) -> EnrichmentBatchResult:
    """Apply enrichment to a batch; aggregate warnings and emit one log summary."""

    started = time.monotonic()
    if not events:
        return EnrichmentBatchResult(events=[], duration_ms=0)

    out_events: list[dict[str, Any]] = []
    all_warnings: list[EnrichmentWarning] = []
    skipped_count = 0
    for ev in events:
        result = execute_enrichment(ev, enrichment, override_policy=override_policy, emit_logs=False)
        all_warnings.extend(result.warnings)
        if result.skipped:
            skipped_count += 1
            continue
        out_events.append(result.event)

    deduped = _dedupe_warnings(all_warnings)
    _emit_batch_warnings(deduped)
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    if deduped:
        logger.info(
            "%s",
            {
                "stage": "enrichment",
                "message": "enrichment batch completed with warnings",
                "warning_count": len(deduped),
                "duration_ms": duration_ms,
                "event_count": len(out_events),
                "skipped_count": skipped_count,
            },
        )

    return EnrichmentBatchResult(
        events=out_events,
        warnings=deduped,
        duration_ms=duration_ms,
        warning_count=len(deduped),
        skipped_count=skipped_count,
    )
