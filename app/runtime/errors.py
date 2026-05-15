"""Platform-wide exception hierarchy — stage/error_code attached at call sites later."""

from __future__ import annotations

from typing import Any


class PlatformError(Exception):
    """Base error for all connector platform failures."""


class SourceFetchError(PlatformError):
    """Source adapter failed (HTTP/DB/webhook ingest).

    Optional ``detail`` is sanitized (masked secrets) for API / UI diagnostics.
    """

    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = dict(detail or {})


class MappingError(PlatformError):
    """Field mapping / JSONPath extraction failed."""


class ParserError(PlatformError):
    """JSONPath expression parse/evaluation failure at compile time."""


class EnrichmentError(PlatformError):
    """Static/calculated enrichment failed."""


class DestinationSendError(PlatformError):
    """Syslog or webhook delivery failed."""


class CheckpointError(PlatformError):
    """Checkpoint read/write violated safety rules."""


class RateLimitError(PlatformError):
    """Source or destination throttling triggered."""


class PreviewRequestError(Exception):
    """Preview / HTTP API test path validation failure (maps to HTTPException in routers)."""

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))
