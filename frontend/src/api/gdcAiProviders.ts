import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type AiProviderType =
  | 'OPENAI'
  | 'AZURE_OPENAI'
  | 'CLAUDE'
  | 'GEMINI'
  | 'OLLAMA'
  | 'VLLM'
  | 'MOCK'

export type AiProviderRead = {
  id: number
  name: string
  provider_type: AiProviderType
  enabled: boolean
  endpoint_url: string
  default_model: string | null
  timeout_seconds: number
  auth_json: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
}

export type AiCredentialValidation = {
  status: 'VALID' | 'INVALID'
  message: string
  latency_ms?: number | null
  http_status?: number | null
}

export type AiTrafficSummary = {
  window_hours: number
  stream_id: number | null
  requests: number
  success_count: number
  failure_count: number
  success_rate: number
  error_rate: number
  avg_latency_ms: number
  top_providers: Array<{
    provider_id: number
    request_count: number
    success_count: number
    failure_count: number
    avg_latency_ms: number
  }>
  failover_count: number
  replay_count: number
  inspected_count: number
  blocked_count: number
  masked_count: number
  redacted_count: number
  policy_blocks: number
  prompt_masks: number
  response_masks: number
}

export async function fetchAiProvidersList(): Promise<AiProviderRead[]> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/ai-providers/`, readJsonOpts)
  return Array.isArray(raw) ? (raw as AiProviderRead[]) : []
}

export async function validateAiProviderCredentials(providerId: number): Promise<AiCredentialValidation> {
  return requestJson<AiCredentialValidation>(`${GDC_API_PREFIX}/ai-providers/${providerId}/validate-credentials`, {
    method: 'POST',
    timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS,
  })
}

export async function fetchAiTrafficSummary(params?: {
  hours?: number
  stream_id?: number
}): Promise<AiTrafficSummary> {
  const q = new URLSearchParams()
  if (params?.hours != null) q.set('hours', String(params.hours))
  if (params?.stream_id != null) q.set('stream_id', String(params.stream_id))
  const qs = q.toString()
  const url = `${GDC_API_PREFIX}/ai-providers/traffic/summary${qs ? `?${qs}` : ''}`
  return requestJson<AiTrafficSummary>(url, readJsonOpts)
}
