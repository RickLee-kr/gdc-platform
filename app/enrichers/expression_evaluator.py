"""Sandboxed calculated-expression evaluation (no eval/exec)."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from app.enrichers.field_paths import get_field_value

_FIELD_REF_RE = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


class ExpressionEvaluationError(Exception):
    """Invalid or unsupported calculated expression."""


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _split_args(arg_blob: str) -> list[str]:
    args: list[str] = []
    depth = 0
    in_single = False
    in_double = False
    start = 0
    i = 0
    while i < len(arg_blob):
        ch = arg_blob[i]
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                args.append(arg_blob[start:i].strip())
                start = i + 1
        i += 1
    tail = arg_blob[start:].strip()
    if tail:
        args.append(tail)
    return args


def _parse_literal(token: str, event: dict[str, Any]) -> Any:
    t = token.strip()
    if not t:
        return ""
    if (t.startswith("'") and t.endswith("'")) or (t.startswith('"') and t.endswith('"')):
        return t[1:-1]
    if t.lower() in {"true", "false"}:
        return t.lower() == "true"
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    if re.fullmatch(r"-?\d+\.\d+", t):
        return float(t)
    if _IDENT_RE.match(t):
        val = get_field_value(event, t)
        if val is not None:
            return val
        return event.get(t)
    raise ExpressionEvaluationError(f"Unsupported token {t!r}")


def _evaluate_function(name: str, arg_blob: str, event: dict[str, Any]) -> Any:
    fn = name.strip().lower()
    args = [_parse_literal(a, event) for a in _split_args(arg_blob)]
    if fn == "concat":
        return "".join(_coerce_str(a) for a in args)
    if fn == "upper":
        if len(args) != 1:
            raise ExpressionEvaluationError("upper() expects exactly one argument")
        return _coerce_str(args[0]).upper()
    if fn == "lower":
        if len(args) != 1:
            raise ExpressionEvaluationError("lower() expects exactly one argument")
        return _coerce_str(args[0]).lower()
    if fn == "coalesce":
        for arg in args:
            if arg is not None and _coerce_str(arg) != "":
                return arg
        return args[-1] if args else ""
    if fn == "now_utc":
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")
    raise ExpressionEvaluationError(f"Unsupported function {name!r}")


def _substitute_field_refs(expression: str, event: dict[str, Any]) -> str:
    def repl(match: re.Match[str]) -> str:
        path = match.group(1).strip()
        val = get_field_value(event, path)
        if val is None:
            val = event.get(path)
        if isinstance(val, str):
            return repr(val)
        if val is None:
            return "''"
        return repr(str(val))

    return _FIELD_REF_RE.sub(repl, expression)


_FUNCTION_NAMES = ("concat", "upper", "lower", "coalesce", "now_utc")


def _replace_innermost_function(expr: str, event: dict[str, Any]) -> tuple[str, bool]:
    lower = expr.lower()
    for fn in _FUNCTION_NAMES:
        search_from = 0
        while True:
            idx = lower.find(f"{fn}(", search_from)
            if idx < 0:
                break
            name_end = idx + len(fn)
            open_paren = name_end
            depth = 1
            pos = open_paren + 1
            in_single = False
            in_double = False
            while pos < len(expr) and depth > 0:
                ch = expr[pos]
                if ch == "'" and not in_double:
                    in_single = not in_single
                elif ch == '"' and not in_single:
                    in_double = not in_double
                elif not in_single and not in_double:
                    if ch == "(":
                        depth += 1
                    elif ch == ")":
                        depth -= 1
                pos += 1
            if depth != 0:
                break
            arg_blob = expr[open_paren + 1 : pos - 1]
            if "(" in arg_blob:
                search_from = open_paren + 1
                continue
            result = _evaluate_function(fn, arg_blob, event)
            expr = expr[:idx] + repr(result) + expr[pos:]
            lower = expr.lower()
            return expr, True
    return expr, False


def _evaluate_function_expression(expression: str, event: dict[str, Any]) -> Any:
    expr = expression.strip()
    if not expr:
        raise ExpressionEvaluationError("Empty expression")
    for _ in range(64):
        expr, changed = _replace_innermost_function(expr, event)
        if not changed:
            break
    else:
        raise ExpressionEvaluationError("Expression too complex")
    return _parse_literal(expr, event)


def _evaluate_legacy_ternary(expression: str, event: dict[str, Any]) -> Any:
    """Support wizard-style ``eventName.includes('X') ? 8 : 3`` without eval."""

    expr = expression.strip()
    if "?" not in expr:
        raise ExpressionEvaluationError("Not a legacy ternary expression")

    def eval_cond(cond: str) -> bool:
        c = cond.strip()
        m = re.match(
            r"^([A-Za-z_][A-Za-z0-9_.]*)\s*\.includes\s*\(\s*['\"]([^'\"]*)['\"]\s*\)\s*$",
            c,
        )
        if m:
            ident, needle = m.group(1), m.group(2)
            val = get_field_value(event, ident)
            if val is None:
                val = event.get(ident)
            return needle in _coerce_str(val)
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_.]*)\s*===\s*['\"]([^'\"]*)['\"]\s*$", c)
        if m:
            ident, expected = m.group(1), m.group(2)
            val = get_field_value(event, ident)
            if val is None:
                val = event.get(ident)
            return _coerce_str(val) == expected
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_.]*)\s*==\s*['\"]?([^'\"]+)['\"]?\s*$", c)
        if m:
            ident, expected = m.group(1), m.group(2)
            val = get_field_value(event, ident)
            if val is None:
                val = event.get(ident)
            return _coerce_str(val) == expected
        raise ExpressionEvaluationError(f"Unsupported legacy condition {c!r}")

    def split_ternary(s: str) -> tuple[str, str, str]:
        q_idx = -1
        ternary_depth = 0
        in_single = False
        in_double = False
        for i, ch in enumerate(s):
            if ch == "'" and not in_double:
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double
            elif not in_single and not in_double:
                if ch == "?":
                    if ternary_depth == 0:
                        q_idx = i
                    ternary_depth += 1
                elif ch == ":":
                    ternary_depth -= 1
                    if ternary_depth == 0 and q_idx >= 0:
                        return s[:q_idx].strip(), s[q_idx + 1 : i].strip(), s[i + 1 :].strip()
        raise ExpressionEvaluationError("Malformed ternary expression")

    def eval_branch(branch: str) -> Any:
        b = branch.strip()
        if "?" in b and ".includes" in b:
            return _evaluate_legacy_ternary(b, event)
        return _parse_literal(b, event)

    cond, true_branch, false_branch = split_ternary(expr)
    return eval_branch(true_branch) if eval_cond(cond) else eval_branch(false_branch)


def evaluate_calculated_expression(expression: str, event: dict[str, Any]) -> Any:
    """Evaluate a calculated enrichment expression against ``event``."""

    raw = expression.strip()
    if not raw:
        raise ExpressionEvaluationError("Empty expression")
    if "{{" in raw or any(
        fn in raw.lower() for fn in ("concat(", "upper(", "lower(", "coalesce(", "now_utc(")
    ):
        substituted = _substitute_field_refs(raw, event)
        return _evaluate_function_expression(substituted, event)
    if "?" in raw and (".includes" in raw or "===" in raw or "==" in raw):
        return _evaluate_legacy_ternary(raw, event)
    if _IDENT_RE.match(raw):
        val = get_field_value(event, raw)
        return val if val is not None else event.get(raw)
    return _evaluate_function_expression(raw, event)
