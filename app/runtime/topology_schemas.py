"""Pydantic schemas for read-only runtime topology aggregation."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.runtime.analytics_schemas import AnalyticsTimeWindow
from app.runtime.health_schemas import HealthLevel, ScoringMode


class TopologySummary(BaseModel):
    """Roll-up counts for the topology graph."""

    connector_count: int = 0
    source_count: int = 0
    stream_count: int = 0
    route_count: int = 0
    destination_count: int = 0
    streams_with_mapping: int = 0
    streams_with_enrichment: int = 0
    enabled_streams: int = 0
    disabled_streams: int = 0
    enabled_routes: int = 0
    disabled_routes: int = 0


class TopologyConnectorNode(BaseModel):
    id: int
    name: str
    status: str
    source_count: int = 0
    stream_count: int = 0


class TopologySourceNode(BaseModel):
    id: int
    connector_id: int
    source_type: str
    enabled: bool
    stream_count: int = 0


class TopologyStreamNode(BaseModel):
    stream_id: int
    stream_name: str
    connector_id: int
    source_id: int
    stream_type: str
    enabled: bool
    status: str
    has_mapping: bool = False
    has_enrichment: bool = False
    enrichment_enabled: bool = False
    route_count: int = 0
    health_level: HealthLevel | None = None
    health_score: int | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


class TopologyRouteNode(BaseModel):
    route_id: int
    stream_id: int
    destination_id: int
    enabled: bool
    status: str
    failure_policy: str
    destination_name: str | None = None
    destination_type: str | None = None
    destination_enabled: bool = False
    health_level: HealthLevel | None = None
    health_score: int | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


class TopologyDestinationNode(BaseModel):
    destination_id: int
    name: str
    destination_type: str
    enabled: bool
    route_count: int = 0
    health_level: HealthLevel | None = None
    health_score: int | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


class RuntimeTopologyResponse(BaseModel):
    """GET /runtime/topology — configured pipeline graph with health summary."""

    time: AnalyticsTimeWindow
    scoring_mode: ScoringMode = Field(
        default="current_runtime",
        description="Health scoring model applied to stream/route/destination nodes.",
    )
    summary: TopologySummary
    connectors: list[TopologyConnectorNode] = Field(default_factory=list)
    sources: list[TopologySourceNode] = Field(default_factory=list)
    streams: list[TopologyStreamNode] = Field(default_factory=list)
    routes: list[TopologyRouteNode] = Field(default_factory=list)
    destinations: list[TopologyDestinationNode] = Field(default_factory=list)
