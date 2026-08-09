"""Schemas for GET /runtime/streams/{stream_id}/governance/workspace-snapshot."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.route_classification.schemas import RouteClassificationEffectiveResponse
from app.route_policy.schemas import RoutePolicyEffectiveResponse
from app.route_protection.schemas import RouteProtectionEffectiveResponse
from app.runtime.schemas import RouteTransformEffectiveResponse


class GovernanceWorkspaceRouteSnapshot(BaseModel):
    """One route's effective governance dimensions for Workspace overview."""

    route_id: int
    route_name: str
    transform: RouteTransformEffectiveResponse
    protection: RouteProtectionEffectiveResponse
    classification: RouteClassificationEffectiveResponse
    policy: RoutePolicyEffectiveResponse


class GovernanceWorkspaceSnapshotResponse(BaseModel):
    """Read-only stream-scoped governance workspace snapshot (bulk effective)."""

    stream_id: int
    route_count: int
    routes: list[GovernanceWorkspaceRouteSnapshot] = Field(default_factory=list)
