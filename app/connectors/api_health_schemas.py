"""Pydantic schemas for Connector/API Health (read-only operator diagnosis)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ConnectorApiHealthStatus = Literal["HEALTHY", "WARNING", "UNHEALTHY", "IDLE"]
ConnectorApiFailureKind = Literal[
    "none",
    "authentication",
    "connectivity",
    "timeout",
    "rate_limit",
    "http_api",
    "runtime",
    "credential_expiration",
]


class ConnectorApiHealthAction(BaseModel):
    id: str
    label: str
    href_hint: str | None = None


class ConnectorApiHealthEvidence(BaseModel):
    kind: Literal["auth_check", "delivery_log", "credential", "stream_health"]
    id: int
    stage: str = ""
    message: str = ""
    created_at: datetime | None = None
    http_status: int | None = None
    error_code: str | None = None


class ConnectorApiHealthStreamRef(BaseModel):
    stream_id: int
    stream_name: str
    status: str = ""
    primary_issue: str | None = None


class ConnectorApiHealthResponse(BaseModel):
    """GET /connectors/{id}/api-health — runtime-truth connector/API posture."""

    connector_id: int
    connector_name: str = ""
    connector_status: str = ""
    health: ConnectorApiHealthStatus = "IDLE"
    problem: str = ""
    cause: str = ""
    failure_kind: ConnectorApiFailureKind = "none"
    recommended_action: str = ""
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    last_auth_check_at: datetime | None = None
    last_auth_check_status: Literal["success", "failed"] | None = None
    last_auth_error: str | None = None
    credential_status: str | None = None
    credential_expires_at: datetime | None = None
    source_rate_limited_count: int = 0
    source_fetch_failed_count: int = 0
    affected_streams: list[ConnectorApiHealthStreamRef] = Field(default_factory=list)
    evidence: list[ConnectorApiHealthEvidence] = Field(default_factory=list)
    actions: list[ConnectorApiHealthAction] = Field(default_factory=list)
    generated_at: datetime
    evidence_limit: int = 100
