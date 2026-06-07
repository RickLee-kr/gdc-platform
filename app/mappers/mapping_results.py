"""Structured mapping outcomes for runtime delivery_logs (no full raw payload)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class MappingFieldError:
    """Field-level transform failure (may still yield null/default on mapped event)."""

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


@dataclass(frozen=True, slots=True)
class MappingEventError:
    """Event-level mapping failure (whole event; suitable for ``stage=mapping`` logs)."""

    error_code: str
    error_message: str

    def to_delivery_log_fields(self) -> dict[str, Any]:
        return {
            "error_code": self.error_code,
            "error_message": self.error_message,
        }


@dataclass(slots=True)
class MappingApplyResult:
    """Per-event mapping output plus structured errors."""

    mapped_event: dict[str, Any]
    field_errors: list[MappingFieldError] = field(default_factory=list)
    event_error: MappingEventError | None = None

    @property
    def ok(self) -> bool:
        return self.event_error is None
