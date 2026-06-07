"""Registry-level errors for connector manifest discovery."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ValidationIssue:
    """Single manifest validation failure."""

    rule_id: str
    message: str
    connector_id: str | None = None
    path: str | None = None


class RegistryError(Exception):
    """Raised when registry load or validation fails."""

    def __init__(self, message: str, *, issues: list[ValidationIssue] | None = None) -> None:
        super().__init__(message)
        self.issues: list[ValidationIssue] = list(issues or [])
