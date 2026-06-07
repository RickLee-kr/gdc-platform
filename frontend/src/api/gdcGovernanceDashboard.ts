import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const GOV = `${GDC_API_PREFIX}/governance`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type GovernanceDashboardRisk = {
  critical: number
  high: number
  medium: number
  low: number
}

export type GovernanceDashboardPolicyHealth = {
  healthy: number
  warning: number
  critical: number
}

export type GovernanceDashboardComplianceSnapshot = {
  violations_24h: number
  quarantines_24h: number
  replays_24h: number
}

export type GovernanceDashboardActivityEntry = {
  event_time: string
  event_type: string
  event_label: string
  policy_id: number | null
  policy_name: string | null
  stream_id: number | null
  stream_name: string | null
  status: string
}

export type GovernanceDashboardSummaryResponse = {
  active_policies: number
  policies_in_review: number
  open_violations: number
  quarantined_events: number
  failed_replays: number
  notification_failures: number
  pending_approvals: number
  pending_replays: number
  risk: GovernanceDashboardRisk
  policy_health: GovernanceDashboardPolicyHealth
  compliance_snapshot: GovernanceDashboardComplianceSnapshot
  recent_activity: GovernanceDashboardActivityEntry[]
}

export async function fetchGovernanceDashboardSummary(): Promise<GovernanceDashboardSummaryResponse> {
  return safeRequestJson<GovernanceDashboardSummaryResponse>(`${GOV}/dashboard/summary`, readJsonOpts)
}
