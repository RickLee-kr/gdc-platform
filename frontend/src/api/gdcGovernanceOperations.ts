import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const GOV = `${GDC_API_PREFIX}/governance`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type OperationsActionPriority = 'critical' | 'high' | 'medium'

export type GovernanceOperationsSummaryResponse = {
  pending_approvals: number
  open_violations: number
  quarantined_events: number
  pending_replays: number
  failed_replays: number
  failed_notifications: number
  pending_notifications: number
}

export type GovernanceOperationsAttentionItem = {
  category: string
  count: number
  label: string
  priority: OperationsActionPriority
}

export type GovernanceOperationsAttentionResponse = {
  items: GovernanceOperationsAttentionItem[]
  is_empty: boolean
}

export type GovernanceOperationsActionRequiredItem = {
  priority: OperationsActionPriority
  category: string
  count: number
  label: string
  recommended_action: string
}

export type GovernanceOperationsApprovalQueueItem = {
  policy_id: number
  policy_name: string
  approval_status: string
  requester: string | null
  submitted_at: string | null
}

export type GovernanceOperationsViolationQueueItem = {
  violation_id: string
  policy_name: string | null
  stream_name: string | null
  severity: string
  status: string
}

export type GovernanceOperationsQuarantineQueueItem = {
  quarantine_id: number
  stream_name: string | null
  policy_name: string | null
  status: string
  quarantine_reason: string | null
}

export type GovernanceOperationsReplayQueueItem = {
  replay_id: number
  stream_name: string | null
  status: string
  outcome: string | null
  error_message: string | null
}

export type GovernanceOperationsNotificationQueueItem = {
  notification_id: number
  event_type: string
  severity: string
  status: string
  created_at: string
}

export type GovernanceOperationsQueueResponse = {
  action_required: GovernanceOperationsActionRequiredItem[]
  pending_approvals: GovernanceOperationsApprovalQueueItem[]
  violations: GovernanceOperationsViolationQueueItem[]
  quarantine: GovernanceOperationsQuarantineQueueItem[]
  replays: GovernanceOperationsReplayQueueItem[]
  notifications: GovernanceOperationsNotificationQueueItem[]
}

export type GovernanceOperationsActivityEntry = {
  event_time: string
  event_type: string
  event_label: string
  policy_id: number | null
  policy_name: string | null
  stream_id: number | null
  stream_name: string | null
  status: string
}

export type GovernanceOperationsActivityResponse = {
  total: number
  events: GovernanceOperationsActivityEntry[]
}

export async function fetchGovernanceOperationsSummary(): Promise<GovernanceOperationsSummaryResponse> {
  return safeRequestJson<GovernanceOperationsSummaryResponse>(`${GOV}/operations/summary`, readJsonOpts)
}

export async function fetchGovernanceOperationsQueue(): Promise<GovernanceOperationsQueueResponse> {
  return safeRequestJson<GovernanceOperationsQueueResponse>(`${GOV}/operations/queue`, readJsonOpts)
}

export async function fetchGovernanceOperationsAttention(): Promise<GovernanceOperationsAttentionResponse> {
  return safeRequestJson<GovernanceOperationsAttentionResponse>(`${GOV}/operations/attention`, readJsonOpts)
}

export async function fetchGovernanceOperationsActivity(
  limit = 50,
): Promise<GovernanceOperationsActivityResponse> {
  return safeRequestJson<GovernanceOperationsActivityResponse>(
    `${GOV}/operations/activity?limit=${limit}`,
    readJsonOpts,
  )
}
