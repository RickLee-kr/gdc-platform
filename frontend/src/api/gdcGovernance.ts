import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const BASE = `${GDC_API_PREFIX}/governance`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type GovernanceCardSummary = {
  rule_count: number
  pending_count: number
  recent_activity_count: number
  last_activity_at: string | null
  top_stream_id: number | null
}

export type GovernanceRecent24h = {
  classified_events: number
  protected_events: number
  quarantined_events: number
  replayed_events: number
  blocked_ai_requests: number
}

export type GovernanceRiskOverview = {
  restricted_events: number
  confidential_events: number
  quarantine_pending: number
  replay_pending: number
  ai_gateway_blocks: number
}

export type GovernanceHealthLevel = 'healthy' | 'warning' | 'critical'

export type GovernanceHealth = {
  status: GovernanceHealthLevel
  pending_quarantine_events: number
  pending_replay_events: number
  ai_gateway_blocks_24h: number
  reasons: string[]
}

export type GovernanceTimelineEvent = {
  event_type: string
  occurred_at: string
  stream_id: number | null
  label: string
}

export type GovernanceCards = {
  classification: GovernanceCardSummary
  protection: GovernanceCardSummary
  policy: GovernanceCardSummary
  quarantine: GovernanceCardSummary
  replay: GovernanceCardSummary
  ai_gateway: GovernanceCardSummary
}

export type PolicyKpiCounts = {
  active: number
  review: number
  draft: number
  retired: number
}

export type PolicyDashboardKpi = {
  active_policies: number
  policies_in_review: number
  quarantined_events: number
  replayed_events: number
}

export type PolicyCatalogSummaryRow = {
  id: number
  name: string
  status: string
  assigned_stream_count: number
  impact_matched_events: number | null
  impact_summary: string | null
  impact_data_available: boolean
}

export type PolicyImpactRankRow = {
  policy_id: number
  policy_name: string
  matched_events: number
  impact_summary: string | null
}

export type WindowedEventSummary = {
  h24: number
  d7: number
  d30: number
}

export type PolicyActivityTimelineEvent = {
  event_type: string
  policy_id: number
  policy_name: string
  occurred_at: string
  label: string
}

export type PolicyDashboardData = {
  has_policies: boolean
  policy_kpi: PolicyKpiCounts
  dashboard_kpi: PolicyDashboardKpi
  policy_activity_timeline: PolicyActivityTimelineEvent[]
  policy_catalog: PolicyCatalogSummaryRow[]
  top_policies_by_impact: PolicyImpactRankRow[]
  quarantine_summary: WindowedEventSummary
  replay_summary: WindowedEventSummary
}

export type GovernanceSummaryResponse = {
  classification_rules: number
  protection_rules: number
  policy_rules: number
  dynamic_routes: number
  failover_routes: number
  pending_replay_events: number
  pending_quarantine_events: number
  ai_gateway_policies: number
  has_governance_rules: boolean
  recent_24h: GovernanceRecent24h
  risk_overview: GovernanceRiskOverview
  health: GovernanceHealth
  activity_timeline: GovernanceTimelineEvent[]
  cards: GovernanceCards
  policy_dashboard: PolicyDashboardData
}

export async function fetchGovernanceSummary(): Promise<GovernanceSummaryResponse | null> {
  return safeRequestJson<GovernanceSummaryResponse>(`${BASE}/summary`, readJsonOpts)
}
