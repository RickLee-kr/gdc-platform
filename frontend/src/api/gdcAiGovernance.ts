import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type AiPolicyViolationStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

export type AiPolicyViolationRead = {
  id: number
  request_id: string
  stream_id: number | null
  ai_provider_id: number | null
  ai_stream_id: number | null
  policy_rule_id: number | null
  provider: string | null
  ai_stream: string | null
  rule_id: string | null
  action: string
  severity: string
  status: AiPolicyViolationStatus
  operator_note: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

export type AiGovernanceRankedItem = {
  key: string
  label: string
  count: number
}

export type AiGovernancePolicyImpact = {
  policy_rule_id: number | null
  rule_id: string | null
  block_count: number
  mask_count: number
  redact_count: number
  total_count: number
}

export type AiGovernanceDashboardSummary = {
  window_hours: number
  total_requests: number
  policy_blocks: number
  policy_violations: number
  mask_events: number
  redact_events: number
  open_violations: number
  acknowledged_violations: number
  resolved_violations: number
  top_violated_policies: AiGovernanceRankedItem[]
  top_providers: AiGovernanceRankedItem[]
  top_ai_streams: AiGovernanceRankedItem[]
  policy_impact: AiGovernancePolicyImpact[]
}

export async function fetchAiGovernanceDashboard(params?: {
  hours?: number
  stream_id?: number
  provider?: number
}): Promise<AiGovernanceDashboardSummary> {
  const q = new URLSearchParams()
  if (params?.hours != null) q.set('hours', String(params.hours))
  if (params?.stream_id != null) q.set('stream_id', String(params.stream_id))
  if (params?.provider != null) q.set('provider', String(params.provider))
  const qs = q.toString()
  const url = `${GDC_API_PREFIX}/ai-governance/dashboard/summary${qs ? `?${qs}` : ''}`
  return requestJson<AiGovernanceDashboardSummary>(url, readJsonOpts)
}

export async function fetchAiPolicyViolations(params?: {
  status?: 'open' | 'acknowledged' | 'resolved' | 'all'
  limit?: number
}): Promise<{ total: number; violations: AiPolicyViolationRead[] }> {
  const q = new URLSearchParams()
  if (params?.status != null) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const qs = q.toString()
  const url = `${GDC_API_PREFIX}/ai-governance/violations${qs ? `?${qs}` : ''}`
  const raw = await safeRequestJson<unknown>(url, readJsonOpts)
  if (raw && typeof raw === 'object' && 'violations' in raw) {
    return raw as { total: number; violations: AiPolicyViolationRead[] }
  }
  return { total: 0, violations: [] }
}

export async function acknowledgeAiPolicyViolation(
  violationId: number,
  note?: string,
): Promise<AiPolicyViolationRead> {
  return requestJson<AiPolicyViolationRead>(
    `${GDC_API_PREFIX}/ai-governance/violations/${violationId}/acknowledge`,
    {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
      timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS,
    },
  )
}

export async function resolveAiPolicyViolation(
  violationId: number,
  note?: string,
): Promise<AiPolicyViolationRead> {
  return requestJson<AiPolicyViolationRead>(
    `${GDC_API_PREFIX}/ai-governance/violations/${violationId}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
      timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS,
    },
  )
}
