"""Static validation for enrichment configuration (no runtime execution)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from app.enrichers.lookup_tables import TABLES, normalize_table_name

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
_RESERVED_TOP_LEVEL = frozenset({"__rules", "__computed", "__preview", "__enrichment_meta"})
_FIELD_PATH_RE = re.compile(r"^[A-Za-z_@][A-Za-z0-9_@]*(\.[A-Za-z_@][A-Za-z0-9_@]*)*$")
_ALLOWED_FUNCTIONS = ("concat", "upper", "lower", "coalesce", "now_utc")
_FIELD_REF_RE = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


@dataclass
class EnrichmentValidationIssue:
    code: str
    severity: Literal["error", "warning"]
    message: str
    rule_type: str | None = None
    target_field: str | None = None
    field: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "rule_type": self.rule_type,
            "target_field": self.target_field,
            "field": self.field,
        }


@dataclass
class EnrichmentValidationResult:
    ok: bool
    issues: list[EnrichmentValidationIssue] = field(default_factory=list)

    def errors(self) -> list[EnrichmentValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    def warnings(self) -> list[EnrichmentValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]


def is_valid_field_path(path: str) -> bool:
    key = path.strip()
    if not key or key.startswith("__"):
        return False
    if ".." in key or key.endswith("."):
        return False
    return bool(_FIELD_PATH_RE.match(key))


def validate_calculated_expression(expression: str) -> list[EnrichmentValidationIssue]:
    issues: list[EnrichmentValidationIssue] = []
    expr = expression.strip()
    if not expr:
        issues.append(
            EnrichmentValidationIssue(
                code="calculated_expression_empty",
                severity="error",
                message="Calculated expression is required",
                rule_type="calculated",
                field="expression",
            )
        )
        return issues
    if expr.count("(") != expr.count(")"):
        issues.append(
            EnrichmentValidationIssue(
                code="calculated_expression_malformed",
                severity="error",
                message="Unbalanced parentheses in expression",
                rule_type="calculated",
                field="expression",
            )
        )
    for ref in _FIELD_REF_RE.findall(expr):
        if not is_valid_field_path(ref):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid field reference {ref!r}",
                    rule_type="calculated",
                    field="expression",
                )
            )
    lower = expr.lower()
    if "{{" not in expr and not any(fn in lower for fn in _ALLOWED_FUNCTIONS):
        if "?" in expr and (".includes" in expr or "===" in expr or "==" in expr):
            return issues
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_.]*$", expr):
            issues.append(
                EnrichmentValidationIssue(
                    code="calculated_expression_unsupported",
                    severity="warning",
                    message="Expression uses legacy syntax; verify with preview before save",
                    rule_type="calculated",
                    field="expression",
                )
            )
    return issues


def _lookup_table_exists(name: str) -> bool:
    raw = name.strip()
    if not raw:
        return False
    return raw in TABLES or normalize_table_name(raw) in TABLES


def _validate_rule_dict(rule: dict[str, Any], *, default_target: str | None = None) -> list[EnrichmentValidationIssue]:
    issues: list[EnrichmentValidationIssue] = []
    rule_type = str(rule.get("type") or "").strip().lower()
    if rule_type not in _RULE_TYPES:
        issues.append(
            EnrichmentValidationIssue(
                code="invalid_rule_type",
                severity="error",
                message=f"Unsupported rule type {rule_type!r}",
                rule_type=rule_type or None,
            )
        )
        return issues

    target = str(
        rule.get("target_field")
        or rule.get("fieldName")
        or rule.get("field_name")
        or default_target
        or ""
    ).strip()
    if not target:
        issues.append(
            EnrichmentValidationIssue(
                code="missing_target_field",
                severity="error",
                message="Target field is required",
                rule_type=rule_type,
                field="target_field",
            )
        )
    else:
        from app.enrichers.timestamp_conversion import is_timestamp_field_path

        from app.enrichers.type_conversion import is_type_conversion_field_path

        path_ok = (
            is_timestamp_field_path(target)
            if rule_type == "timestamp_conversion"
            else is_type_conversion_field_path(target)
            if rule_type == "type_conversion"
            else is_valid_field_path(target)
        )
        if not path_ok:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid target field path {target!r}",
                    rule_type=rule_type,
                    target_field=target,
                    field="target_field",
                )
            )

    if rule.get("enabled") is False:
        return issues

    if rule_type == "calculated":
        issues.extend(validate_calculated_expression(str(rule.get("expression") or "")))
        for issue in issues:
            if issue.target_field is None:
                issue.target_field = target or None
    elif rule_type == "lookup":
        table = str(rule.get("lookup_table") or rule.get("lookupTable") or "").strip()
        key_field = str(
            rule.get("lookup_key_field") or rule.get("lookupKeyField") or rule.get("key_field") or ""
        ).strip()
        if not table:
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_lookup_table",
                    severity="error",
                    message="Lookup table is required",
                    rule_type="lookup",
                    target_field=target or None,
                    field="lookup_table",
                )
            )
        elif not _lookup_table_exists(table):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_lookup_table",
                    severity="error",
                    message=f"Unknown lookup table {table!r}",
                    rule_type="lookup",
                    target_field=target or None,
                    field="lookup_table",
                )
            )
        if not key_field:
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_lookup_key_field",
                    severity="error",
                    message="Lookup key field is required",
                    rule_type="lookup",
                    target_field=target or None,
                    field="lookup_key_field",
                )
            )
        elif not is_valid_field_path(key_field):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid lookup key field {key_field!r}",
                    rule_type="lookup",
                    target_field=target or None,
                    field="lookup_key_field",
                )
            )
    elif rule_type == "conditional":
        conditions = rule.get("conditions")
        if not isinstance(conditions, list) or len(conditions) == 0:
            issues.append(
                EnrichmentValidationIssue(
                    code="conditional_invalid",
                    severity="error",
                    message="At least one condition is required",
                    rule_type="conditional",
                    target_field=target or None,
                    field="conditions",
                )
            )
        else:
            has_valid_when = False
            for idx, item in enumerate(conditions):
                if not isinstance(item, dict):
                    continue
                when = str(item.get("when") or "").strip()
                if when:
                    has_valid_when = True
                elif str(item.get("then") or "").strip():
                    issues.append(
                        EnrichmentValidationIssue(
                            code="conditional_invalid",
                            severity="warning",
                            message=f"Condition {idx + 1} has 'then' without 'when'",
                            rule_type="conditional",
                            target_field=target or None,
                            field="conditions",
                        )
                    )
            if not has_valid_when and not str(rule.get("default") or rule.get("conditionalDefault") or "").strip():
                issues.append(
                    EnrichmentValidationIssue(
                        code="conditional_invalid",
                        severity="warning",
                        message="No when clauses or default value; rule may produce empty output",
                        rule_type="conditional",
                        target_field=target or None,
                        field="conditions",
                    )
                )
    elif rule_type == "normalize":
        from app.enrichers.normalize_rule import (
            ON_FAILURE_POLICIES,
            NormalizeRuleError,
            is_normalize_field_path,
            normalize_on_failure,
            resolve_normalize_operation,
        )

        source = str(
            rule.get("source_field") or rule.get("normalizeSourceField") or rule.get("sourceField") or ""
        ).strip()
        if not source:
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_source_field",
                    severity="error",
                    message="Normalize source field is required",
                    rule_type="normalize",
                    target_field=target or None,
                    field="source_field",
                )
            )
        elif not is_normalize_field_path(source):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid normalize source field {source!r}",
                    rule_type="normalize",
                    target_field=target or None,
                    field="source_field",
                )
            )
        try:
            resolve_normalize_operation(rule)
        except NormalizeRuleError as exc:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_normalize_operation",
                    severity="error",
                    message=str(exc),
                    rule_type="normalize",
                    target_field=target or None,
                    field="operation",
                )
            )
        on_failure_raw = rule.get("on_failure") or rule.get("normalizeOnFailure")
        if on_failure_raw is not None and str(on_failure_raw).strip():
            try:
                normalize_on_failure(on_failure_raw)
            except NormalizeRuleError:
                issues.append(
                    EnrichmentValidationIssue(
                        code="invalid_on_failure",
                        severity="error",
                        message=f"Unsupported on_failure {on_failure_raw!r}; expected one of {sorted(ON_FAILURE_POLICIES)}",
                        rule_type="normalize",
                        target_field=target or None,
                        field="on_failure",
                    )
                )
    elif rule_type == "timestamp_conversion":
        from app.enrichers.timestamp_conversion import (
            INPUT_FORMATS,
            ON_FAILURE_POLICIES,
            OUTPUT_FORMATS,
            TimestampConversionError,
            is_timestamp_field_path,
            normalize_input_format,
            normalize_on_failure,
            normalize_output_format,
            parse_timezone_config,
            rule_formats_equivalent,
        )

        source = str(
            rule.get("source_field")
            or rule.get("tsSourceField")
            or rule.get("sourceField")
            or ""
        ).strip()
        if not source:
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_source_field",
                    severity="error",
                    message="Source field is required",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="source_field",
                )
            )
        elif not is_timestamp_field_path(source):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid source field path {source!r}",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="source_field",
                )
            )

        input_fmt_raw = rule.get("input_format") or rule.get("tsInputFormat") or "auto"
        output_fmt_raw = rule.get("output_format") or rule.get("tsOutputFormat") or "utc_iso8601"
        try:
            input_fmt = normalize_input_format(input_fmt_raw)
        except TimestampConversionError:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_input_format",
                    severity="error",
                    message=f"Unsupported input format {input_fmt_raw!r}; expected one of {sorted(INPUT_FORMATS)}",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="input_format",
                )
            )
            input_fmt = ""
        try:
            output_fmt = normalize_output_format(output_fmt_raw)
        except TimestampConversionError:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_output_format",
                    severity="error",
                    message=f"Unsupported output format {output_fmt_raw!r}; expected one of {sorted(OUTPUT_FORMATS)}",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="output_format",
                )
            )
            output_fmt = ""
        if input_fmt and output_fmt and rule_formats_equivalent(input_fmt, output_fmt):
            issues.append(
                EnrichmentValidationIssue(
                    code="timestamp_formats_identical",
                    severity="warning",
                    message="Input format and output format are the same; conversion may be a no-op",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="output_format",
                )
            )

        try:
            tz_mode, tz_iana = parse_timezone_config(rule.get("timezone") or rule.get("tsTimezoneMode") or "utc")
            if tz_mode == "custom":
                custom = tz_iana or str(rule.get("tsCustomTimezone") or "").strip()
                parse_timezone_config({"mode": "custom", "iana": custom})
        except TimestampConversionError as exc:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_timezone",
                    severity="error",
                    message=str(exc),
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="timezone",
                )
            )

        on_failure_raw = rule.get("on_failure") or rule.get("tsOnFailure") or "keep_original"
        try:
            normalize_on_failure(on_failure_raw)
        except TimestampConversionError:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_on_failure",
                    severity="error",
                    message=f"Unsupported on_failure {on_failure_raw!r}; expected one of {sorted(ON_FAILURE_POLICIES)}",
                    rule_type="timestamp_conversion",
                    target_field=target or None,
                    field="on_failure",
                )
            )

    elif rule_type == "type_conversion":
        from app.enrichers.type_conversion import (
            ON_FAILURE_POLICIES,
            TARGET_TYPES,
            TypeConversionError,
            is_type_conversion_field_path,
            normalize_on_failure,
            normalize_target_type,
        )

        source = str(
            rule.get("source_field")
            or rule.get("tcSourceField")
            or rule.get("sourceField")
            or ""
        ).strip()
        if not source:
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_source_field",
                    severity="error",
                    message="Source field is required",
                    rule_type="type_conversion",
                    target_field=target or None,
                    field="source_field",
                )
            )
        elif not is_type_conversion_field_path(source):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid source field path {source!r}",
                    rule_type="type_conversion",
                    target_field=target or None,
                    field="source_field",
                )
            )

        target_type_raw = rule.get("target_type") or rule.get("tcTargetType") or ""
        if not str(target_type_raw).strip():
            issues.append(
                EnrichmentValidationIssue(
                    code="missing_target_type",
                    severity="error",
                    message="Target type is required",
                    rule_type="type_conversion",
                    target_field=target or None,
                    field="target_type",
                )
            )
        else:
            try:
                normalize_target_type(target_type_raw)
            except TypeConversionError:
                issues.append(
                    EnrichmentValidationIssue(
                        code="invalid_target_type",
                        severity="error",
                        message=f"Unsupported target type {target_type_raw!r}; expected one of {sorted(TARGET_TYPES)}",
                        rule_type="type_conversion",
                        target_field=target or None,
                        field="target_type",
                    )
                )

        on_failure_raw = rule.get("on_failure") or rule.get("tcOnFailure") or "keep_original"
        try:
            normalize_on_failure(on_failure_raw)
        except TypeConversionError:
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_on_failure",
                    severity="error",
                    message=f"Unsupported on_failure {on_failure_raw!r}; expected one of {sorted(ON_FAILURE_POLICIES)}",
                    rule_type="type_conversion",
                    target_field=target or None,
                    field="on_failure",
                )
            )

    elif rule_type == "jsonata":
        expression = str(rule.get("expression") or "").strip()
        if not expression:
            issues.append(
                EnrichmentValidationIssue(
                    code="jsonata_expression_empty",
                    severity="error",
                    message="JSONata expression is required",
                    rule_type="jsonata",
                    target_field=target or None,
                    field="expression",
                )
            )

    return issues


def _iter_rules_from_enrichment(enrichment: dict[str, Any]) -> list[tuple[dict[str, Any], str | None]]:
    rules: list[tuple[dict[str, Any], str | None]] = []
    for key, value in enrichment.items():
        if key in _RESERVED_TOP_LEVEL:
            continue
        if isinstance(value, dict) and "type" in value:
            rules.append((value, str(key)))
    raw_rules = enrichment.get("__rules")
    if isinstance(raw_rules, dict):
        for key, value in raw_rules.items():
            key_type = str(key).strip().lower()
            if isinstance(value, dict) and "type" in value:
                rules.append((value, str(key)))
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        merged = dict(item)
                        if key_type in _RULE_TYPES and "type" not in merged:
                            merged["type"] = key_type
                        rules.append((merged, None))
    return rules


def validate_enrichment_json(enrichment: dict[str, Any] | None) -> EnrichmentValidationResult:
    """Validate enrichment configuration without executing rules."""

    if not enrichment:
        return EnrichmentValidationResult(ok=True)

    issues: list[EnrichmentValidationIssue] = []
    targets_seen: dict[str, str] = {}

    for key, value in enrichment.items():
        if key in _RESERVED_TOP_LEVEL:
            continue
        if isinstance(value, dict) and "type" in value:
            continue
        if not isinstance(key, str) or not key.strip():
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_static_field",
                    severity="error",
                    message="Static enrichment field name is required",
                    rule_type="static",
                    field="fieldName",
                )
            )
        elif not is_valid_field_path(key):
            issues.append(
                EnrichmentValidationIssue(
                    code="invalid_field_path",
                    severity="error",
                    message=f"Invalid static field path {key!r}",
                    rule_type="static",
                    target_field=key,
                    field="fieldName",
                )
            )
        else:
            kl = key.strip().lower()
            if kl in targets_seen:
                issues.append(
                    EnrichmentValidationIssue(
                        code="duplicate_target_field",
                        severity="warning",
                        message=f"Duplicate target field {key!r} (also used by {targets_seen[kl]})",
                        rule_type="static",
                        target_field=key,
                        field="fieldName",
                    )
                )
            else:
                targets_seen[kl] = key

    for rule, default_target in _iter_rules_from_enrichment(enrichment):
        for issue in _validate_rule_dict(rule, default_target=default_target):
            issues.append(issue)
        target = str(
            rule.get("target_field")
            or rule.get("fieldName")
            or default_target
            or ""
        ).strip()
        if target and rule.get("enabled") is not False:
            kl = target.lower()
            if kl in targets_seen:
                issues.append(
                    EnrichmentValidationIssue(
                        code="duplicate_target_field",
                        severity="warning",
                        message=f"Duplicate target field {target!r} (also used by {targets_seen[kl]})",
                        rule_type=str(rule.get("type") or ""),
                        target_field=target,
                        field="target_field",
                    )
                )
            else:
                targets_seen[kl] = target

    ok = not any(i.severity == "error" for i in issues)
    return EnrichmentValidationResult(ok=ok, issues=issues)
