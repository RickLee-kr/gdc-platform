"""Pydantic models for governance summary API."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class GovernanceCardSummary(BaseModel):
    """Per-domain card metrics for the Governance dashboard."""

    rule_count: int = 0
    pending_count: int = 0
    recent_activity_count: int = 0
    last_activity_at: datetime | None = None
    top_stream_id: int | None = None


class GovernanceRecent24h(BaseModel):
    classified_events: int = 0
    protected_events: int = 0
    quarantined_events: int = 0
    replayed_events: int = 0
    blocked_ai_requests: int = 0


class GovernanceRiskOverview(BaseModel):
    restricted_events: int = 0
    confidential_events: int = 0
    quarantine_pending: int = 0
    replay_pending: int = 0
    ai_gateway_blocks: int = 0


class GovernanceCards(BaseModel):
    classification: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)
    protection: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)
    policy: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)
    quarantine: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)
    replay: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)
    ai_gateway: GovernanceCardSummary = Field(default_factory=GovernanceCardSummary)


class GovernanceHealthLevel(str, Enum):
    healthy = "healthy"
    warning = "warning"
    critical = "critical"


class GovernanceHealth(BaseModel):
    """Threshold-based operational health derived from pending work and 24h AI blocks."""

    status: GovernanceHealthLevel = GovernanceHealthLevel.healthy
    pending_quarantine_events: int = 0
    pending_replay_events: int = 0
    ai_gateway_blocks_24h: int = 0
    reasons: list[str] = Field(default_factory=list)


class GovernanceTimelineEvent(BaseModel):
    """Read-only recent governance activity (rolling 24h window)."""

    event_type: str
    occurred_at: datetime
    stream_id: int | None = None
    label: str


class PolicyKpiCounts(BaseModel):
    """Named policy lifecycle counts for dashboard KPI strip."""

    active: int = 0
    review: int = 0
    draft: int = 0
    retired: int = 0


class PolicyDashboardKpi(BaseModel):
    """Top-level dashboard KPI tiles."""

    active_policies: int = 0
    policies_in_review: int = 0
    quarantined_events: int = 0
    replayed_events: int = 0


class PolicyCatalogSummaryRow(BaseModel):
    """Policy catalog row for dashboard summary (top N)."""

    id: int
    name: str
    status: str
    assigned_stream_count: int = 0
    impact_matched_events: int | None = None
    impact_summary: str | None = None
    impact_data_available: bool = False


class PolicyImpactRankRow(BaseModel):
    """Top policies by 24h impact match count."""

    policy_id: int
    policy_name: str
    matched_events: int = 0
    impact_summary: str | None = None


class WindowedEventSummary(BaseModel):
    """Event counts across rolling windows (24h / 7d / 30d)."""

    h24: int = 0
    d7: int = 0
    d30: int = 0


class PolicyActivityTimelineEvent(BaseModel):
    """Policy lifecycle activity for dashboard timeline."""

    event_type: str
    policy_id: int
    policy_name: str
    occurred_at: datetime
    label: str


class PolicyDashboardData(BaseModel):
    """Policy-centric dashboard aggregates (M18.5)."""

    has_policies: bool = False
    policy_kpi: PolicyKpiCounts = Field(default_factory=PolicyKpiCounts)
    dashboard_kpi: PolicyDashboardKpi = Field(default_factory=PolicyDashboardKpi)
    policy_activity_timeline: list[PolicyActivityTimelineEvent] = Field(default_factory=list)
    policy_catalog: list[PolicyCatalogSummaryRow] = Field(default_factory=list)
    top_policies_by_impact: list[PolicyImpactRankRow] = Field(default_factory=list)
    quarantine_summary: WindowedEventSummary = Field(default_factory=WindowedEventSummary)
    replay_summary: WindowedEventSummary = Field(default_factory=WindowedEventSummary)


class GovernanceDashboardRiskDistribution(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0


class GovernanceDashboardPolicyHealth(BaseModel):
    healthy: int = 0
    warning: int = 0
    critical: int = 0


class GovernanceDashboardComplianceSnapshot(BaseModel):
    violations_24h: int = 0
    quarantines_24h: int = 0
    replays_24h: int = 0


class GovernanceDashboardActivityEntry(BaseModel):
    event_time: datetime
    event_type: str
    event_label: str
    policy_id: int | None = None
    policy_name: str | None = None
    stream_id: int | None = None
    stream_name: str | None = None
    status: str


class GovernanceDashboardSummaryResponse(BaseModel):
    """GET /governance/dashboard/summary — executive read-only dashboard (M20.3)."""

    active_policies: int = 0
    policies_in_review: int = 0
    open_violations: int = 0
    quarantined_events: int = 0
    failed_replays: int = 0
    notification_failures: int = 0
    pending_approvals: int = 0
    pending_replays: int = 0
    risk: GovernanceDashboardRiskDistribution = Field(default_factory=GovernanceDashboardRiskDistribution)
    policy_health: GovernanceDashboardPolicyHealth = Field(default_factory=GovernanceDashboardPolicyHealth)
    compliance_snapshot: GovernanceDashboardComplianceSnapshot = Field(
        default_factory=GovernanceDashboardComplianceSnapshot
    )
    recent_activity: list[GovernanceDashboardActivityEntry] = Field(default_factory=list)
    read_status: Literal["ok", "degraded", "partial", "stale"] = "ok"
    warnings: list[str] = Field(default_factory=list)


class GovernanceSummaryResponse(BaseModel):
    """GET /governance/summary response."""

    classification_rules: int = 0
    protection_rules: int = 0
    policy_rules: int = 0
    dynamic_routes: int = 0
    failover_routes: int = 0
    pending_replay_events: int = 0
    pending_quarantine_events: int = 0
    ai_gateway_policies: int = 0
    has_governance_rules: bool = False
    recent_24h: GovernanceRecent24h = Field(default_factory=GovernanceRecent24h)
    risk_overview: GovernanceRiskOverview = Field(default_factory=GovernanceRiskOverview)
    health: GovernanceHealth = Field(default_factory=GovernanceHealth)
    activity_timeline: list[GovernanceTimelineEvent] = Field(default_factory=list)
    cards: GovernanceCards = Field(default_factory=GovernanceCards)
    policy_dashboard: PolicyDashboardData = Field(default_factory=PolicyDashboardData)
