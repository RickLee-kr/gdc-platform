import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

const BASE = `${GDC_API_PREFIX}/ai-gateway`

export type AiGatewayDecision = 'allow' | 'audit' | 'block' | 'quarantine'

export type AiGatewayPolicyEntry = {
  id: number
  name: string
  enabled: boolean
  condition_json: Record<string, unknown>
  action_type: AiGatewayDecision
  condition_summary: string
  created_at: string
  updated_at: string
}

export type AiGatewayPolicyListResponse = {
  policies: AiGatewayPolicyEntry[]
}

export async function fetchAiGatewayPolicies(): Promise<AiGatewayPolicyListResponse | null> {
  return safeRequestJson<AiGatewayPolicyListResponse>(`${BASE}/policies`, readJsonOpts)
}

export type AiGatewayRequestEntry = {
  request_id: string
  stream_id: number | null
  classification_level: string
  decision: AiGatewayDecision
  provider: string
  processing_time_ms: number
  matched_policy_count: number
  created_at: string
}

export type AiGatewaySummaryResponse = {
  allow_count: number
  audit_count: number
  block_count: number
  quarantine_count: number
  avg_processing_time_ms: number
  recent_requests: AiGatewayRequestEntry[]
  policies: AiGatewayPolicyEntry[]
}

export async function fetchAiGatewaySummary(): Promise<AiGatewaySummaryResponse | null> {
  return safeRequestJson<AiGatewaySummaryResponse>(`${BASE}/summary`, readJsonOpts)
}
