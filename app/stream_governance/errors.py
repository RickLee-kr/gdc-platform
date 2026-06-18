"""Stream governance validation errors — Contract v1 error codes."""

from __future__ import annotations


class StreamGovernanceValidationError(Exception):
    """Raised when governance document fails Contract v1 validation."""

    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        self.message = message
        super().__init__(message)
