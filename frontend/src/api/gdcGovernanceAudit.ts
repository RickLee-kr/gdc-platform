import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const GOV = `${GDC_API_PREFIX}/governance`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type AuditEventType =
  | 'POLICY_ACTIVATED'
  | 'SUBMITTED_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REQUEST_CHANGES'
  | 'APPROVAL_ACTIVATED'
  | 'VIOLATION_CREATED'
  | 'QUARANTINE_CREATED'
  | 'QUARANTINE_RELEASED'
  | 'QUARANTINE_DISCARDED'
  | 'REPLAY_STARTED'
  | 'REPLAY_COMPLETED'
  | 'REPLAY_FAILED'

export type AuditStatus =
  | 'ACTIVE'
  | 'OPEN'
  | 'QUARANTINED'
  | 'RELEASED'
  | 'DISCARDED'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'FAILED'

export type AuditWindow = '24h' | '7d' | '30d'
export type AuditOutcome = 'DELIVERED' | 'DISCARDED' | 'FAILED'

export type GovernanceAuditEntry = {
  event_time: string
  policy_id: number | null
  policy_name: string
  stream_id: number | null
  stream_name: string | null
  event_type: AuditEventType
  status: AuditStatus
  correlation_id: string
}

export type GovernanceAuditListResponse = {
  window: AuditWindow
  total: number
  events: GovernanceAuditEntry[]
}

export type GovernanceAuditTimelineStep = {
  event_time: string
  event_type: AuditEventType
  summary: string
  actor: string | null
}

export type GovernanceAuditViolationRef = {
  violation_id: string
  status: string
  reason: string | null
}

export type GovernanceAuditQuarantineRef = {
  quarantine_event_id: number
  status: string
}

export type GovernanceAuditReplayRef = {
  replay_event_id: number
  status: string
  event_count: number
}

export type GovernanceAuditDetailResponse = {
  correlation_id: string
  policy_id: number | null
  policy_name: string
  stream_id: number | null
  stream_name: string | null
  current_status: AuditStatus
  outcome: AuditOutcome | null
  timeline: GovernanceAuditTimelineStep[]
  related_violation: GovernanceAuditViolationRef | null
  related_quarantine: GovernanceAuditQuarantineRef | null
  related_replay: GovernanceAuditReplayRef | null
}

export type AuditListFilters = {
  window?: AuditWindow
  policy_id?: number
  stream_id?: number
  event_type?: AuditEventType
  status?: AuditStatus
  limit?: number
}

function buildQuery(filters?: AuditListFilters): string {
  const q = new URLSearchParams()
  if (filters?.window) q.set('window', filters.window)
  if (filters?.policy_id != null) q.set('policy_id', String(filters.policy_id))
  if (filters?.stream_id != null) q.set('stream_id', String(filters.stream_id))
  if (filters?.event_type) q.set('event_type', filters.event_type)
  if (filters?.status) q.set('status', filters.status)
  if (filters?.limit != null) q.set('limit', String(filters.limit))
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export async function fetchGovernanceAuditEvents(
  filters?: AuditListFilters,
): Promise<GovernanceAuditListResponse | null> {
  return safeRequestJson<GovernanceAuditListResponse>(
    `${GOV}/audit${buildQuery(filters)}`,
    readJsonOpts,
  )
}

export async function fetchGovernanceAuditDetail(
  correlationId: string,
  window: AuditWindow = '30d',
): Promise<GovernanceAuditDetailResponse | null> {
  return safeRequestJson<GovernanceAuditDetailResponse>(
    `${GOV}/audit/${encodeURIComponent(correlationId)}?window=${window}`,
    readJsonOpts,
  )
}
