"""Materialization validation errors (TPL-001..TPL-005)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MaterializationError(Exception):
    """Structured materialization failure surfaced to HTTP layer."""

    error_code: str
    message: str
    rule_id: str | None = None

    def __str__(self) -> str:
        return self.message
