"""Batch-scoped protection rules (not persisted to stream_protection_rules)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EphemeralProtectionRule:
    """In-memory rule applied only for the current protect_batch call."""

    stream_id: int
    field_path: str
    protection_mode: str
    sensitivity_class: str | None = None
    enabled: bool = True
    id: int | None = None
