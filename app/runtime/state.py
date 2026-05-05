"""Runtime status enumerations — aligned with master design §16."""

from enum import StrEnum


class ConnectorStatus(StrEnum):
    """Aggregate connector health (master design §16.1)."""

    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    DEGRADED = "DEGRADED"
    ERROR = "ERROR"


class StreamStatus(StrEnum):
    """Per-stream execution state (master design §16.2)."""

    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    ERROR = "ERROR"
    PAUSED = "PAUSED"
    PAUSED_SYSLOG_DOWN = "PAUSED_SYSLOG_DOWN"
    RATE_LIMITED_SOURCE = "RATE_LIMITED_SOURCE"
    RATE_LIMITED_DESTINATION = "RATE_LIMITED_DESTINATION"


class RouteStatus(StrEnum):
    """Per-route delivery path state (master design §16.3)."""

    ENABLED = "ENABLED"
    DISABLED = "DISABLED"
    ERROR = "ERROR"
    RATE_LIMITED = "RATE_LIMITED"
