"""Platform-wide exception hierarchy — stage/error_code attached at call sites later."""


class PlatformError(Exception):
    """Base error for all connector platform failures."""


class SourceFetchError(PlatformError):
    """Source adapter failed (HTTP/DB/webhook ingest)."""


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
