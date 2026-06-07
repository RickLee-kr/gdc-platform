"""Pydantic schemas for failover routing APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FailoverRouteItem(BaseModel):
    id: int
    stream_id: int
    primary_destination_id: int
    primary_destination_name: str | None = None
    secondary_destination_id: int
    secondary_destination_name: str | None = None
    enabled: bool
    policy: str = "ACTIVE_STANDBY"
    created_at: datetime
    updated_at: datetime


class StreamFailoverRoutesResponse(BaseModel):
    stream_id: int
    routes: list[FailoverRouteItem]
    route_count: int


class FailoverRouteCreateRequest(BaseModel):
    primary_destination_id: int
    secondary_destination_id: int
    enabled: bool = True


class FailoverRoutePatchRequest(BaseModel):
    primary_destination_id: int | None = None
    secondary_destination_id: int | None = None
    enabled: bool | None = None


class FailoverRouteResponse(BaseModel):
    route: FailoverRouteItem


class FailoverPlanPreview(BaseModel):
    primary: str
    secondary: str


class StreamFailoverRoutingSummaryResponse(BaseModel):
    stream_id: int
    total_failover_routes: int = 0
    failover_attempts: int = 0
    failover_successes: int = 0
    failover_failures: int = 0
    last_evaluated_at: datetime | None = None


class PlatformFailoverRoutingSummaryResponse(BaseModel):
    total_failover_routes: int = 0
    failover_attempts: int = 0
    failover_successes: int = 0
    failover_failures: int = 0
