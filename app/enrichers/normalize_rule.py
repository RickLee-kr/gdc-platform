"""Normalize transform for enrichment ``__rules``.

Applies common string normalizations (trim, case, email/hostname/username
cleanup) with the same on_failure policies as Timestamp/Type Conversion.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from app.enrichers.field_paths import is_valid_field_path

NormalizeOperation = Literal[
    "trim",
    "lowercase",
    "uppercase",
    "remove_domain",
    "extract_domain",
    "normalize_hostname",
    "normalize_email",
    "normalize_username",
    "remove_whitespace",
    "replace_empty_with_null",
    "iso8601",
]
OnFailure = Literal["keep_original", "set_null", "drop_field", "skip_event"]

NORMALIZE_OPERATIONS: frozenset[str] = frozenset(
    {
        "trim",
        "lowercase",
        "uppercase",
        "remove_domain",
        "extract_domain",
        "normalize_hostname",
        "normalize_email",
        "normalize_username",
        "remove_whitespace",
        "replace_empty_with_null",
        # Legacy format alias kept for existing configs.
        "iso8601",
        "iso_8601",
    }
)
ON_FAILURE_POLICIES: frozenset[str] = frozenset(
    {"keep_original", "set_null", "drop_field", "skip_event"}
)

_WHITESPACE_RE = re.compile(r"\s+")


class NormalizeRuleError(ValueError):
    """Raised when a value cannot be normalized with the requested operation."""


@dataclass(frozen=True, slots=True)
class NormalizeResult:
    value: Any
    skipped: bool = False
    dropped: bool = False
    warning: str | None = None


def normalize_operation(raw: object) -> str:
    key = str(raw or "").strip().lower().replace("-", "_")
    aliases = {
        "iso_8601": "iso8601",
        "lower": "lowercase",
        "upper": "uppercase",
        "strip": "trim",
    }
    key = aliases.get(key, key)
    if key not in NORMALIZE_OPERATIONS:
        raise NormalizeRuleError(f"Unsupported normalize operation {raw!r}")
    if key == "iso_8601":
        return "iso8601"
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
        raise NormalizeRuleError(f"Unsupported on_failure {raw!r}")
    return key


def resolve_normalize_operation(rule: dict[str, Any]) -> str:
    """Prefer ``operation``; fall back to legacy ``format`` / wizard camelCase."""

    raw = (
        rule.get("operation")
        or rule.get("normalizeOperation")
        or rule.get("format")
        or rule.get("normalizeFormat")
        or "trim"
    )
    return normalize_operation(raw)


def is_normalize_field_path(path: str) -> bool:
    return is_valid_field_path(path)


def _as_text(raw: Any) -> str:
    if raw is None:
        return ""
    return str(raw)


def _apply_operation(raw: Any, *, operation: str) -> Any:
    op = normalize_operation(operation)

    if op == "replace_empty_with_null":
        text = _as_text(raw)
        if text.strip() == "":
            return None
        return raw if not isinstance(raw, str) else text

    text = _as_text(raw)

    if op == "trim":
        return text.strip()
    if op == "lowercase":
        return text.lower()
    if op == "uppercase":
        return text.upper()
    if op == "remove_whitespace":
        return _WHITESPACE_RE.sub("", text)

    if op == "normalize_email":
        cleaned = text.strip().lower()
        if not cleaned:
            raise NormalizeRuleError("Empty value cannot normalize_email")
        if "@" not in cleaned:
            raise NormalizeRuleError(f"Value is not an email: {raw!r}")
        local, _, domain = cleaned.partition("@")
        if not local or not domain:
            raise NormalizeRuleError(f"Invalid email: {raw!r}")
        return f"{local}@{domain}"

    if op == "normalize_username":
        cleaned = text.strip()
        if not cleaned:
            raise NormalizeRuleError("Empty value cannot normalize_username")
        if "\\" in cleaned:
            return cleaned.rsplit("\\", 1)[-1].strip()
        if "@" in cleaned:
            return cleaned.split("@", 1)[0].strip()
        return cleaned

    if op == "normalize_hostname":
        cleaned = text.strip().lower()
        if not cleaned:
            raise NormalizeRuleError("Empty value cannot normalize_hostname")
        # Strip trailing dots, then take short hostname (first label).
        cleaned = cleaned.rstrip(".")
        return cleaned.split(".", 1)[0]

    if op == "extract_domain":
        cleaned = text.strip()
        if "@" not in cleaned:
            raise NormalizeRuleError(f"Cannot extract_domain from {raw!r}")
        _, _, domain = cleaned.partition("@")
        domain = domain.strip().lower()
        if not domain:
            raise NormalizeRuleError(f"Cannot extract_domain from {raw!r}")
        return domain

    if op == "remove_domain":
        cleaned = text.strip()
        if "@" in cleaned:
            local = cleaned.split("@", 1)[0].strip()
            if not local:
                raise NormalizeRuleError(f"Cannot remove_domain from {raw!r}")
            return local
        if "\\" in cleaned:
            return cleaned.rsplit("\\", 1)[-1].strip()
        raise NormalizeRuleError(f"Cannot remove_domain from {raw!r}")

    if op == "iso8601":
        try:
            if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                return datetime.fromtimestamp(float(raw), tz=UTC).isoformat().replace("+00:00", "Z")
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            aware = parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
            return aware.astimezone(UTC).isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError) as exc:
            raise NormalizeRuleError(str(exc)) from exc

    raise NormalizeRuleError(f"Unsupported normalize operation {operation!r}")


def apply_normalize(
    raw: Any,
    *,
    operation: str,
    on_failure: str = "keep_original",
) -> NormalizeResult:
    failure = normalize_on_failure(on_failure)
    try:
        value = _apply_operation(raw, operation=operation)
        return NormalizeResult(value=value)
    except NormalizeRuleError as exc:
        if failure == "keep_original":
            return NormalizeResult(value=raw, warning=str(exc))
        if failure == "set_null":
            return NormalizeResult(value=None, warning=str(exc))
        if failure == "drop_field":
            return NormalizeResult(value=None, dropped=True, warning=str(exc))
        if failure == "skip_event":
            return NormalizeResult(value=None, skipped=True, warning=str(exc))
        raise


def preview_normalize_safe(raw: Any, *, operation: str) -> tuple[Any | None, str | None]:
    """Return normalized value or (None, warning) for UI preview."""

    try:
        return _apply_operation(raw, operation=operation), None
    except NormalizeRuleError as exc:
        return None, str(exc)


__all__ = [
    "NORMALIZE_OPERATIONS",
    "ON_FAILURE_POLICIES",
    "NormalizeResult",
    "NormalizeRuleError",
    "apply_normalize",
    "is_normalize_field_path",
    "normalize_on_failure",
    "normalize_operation",
    "preview_normalize_safe",
    "resolve_normalize_operation",
]
