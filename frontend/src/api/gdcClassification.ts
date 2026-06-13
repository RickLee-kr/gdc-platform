import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type ClassificationLevel = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'

export type ClassificationRule = {
  id: number
  stream_id: number
  name: string
  enabled: boolean
  condition_json: Record<string, unknown>
  classification_level: ClassificationLevel
  created_at: string
  updated_at: string
}

export type StreamClassificationRulesResponse = {
  stream_id: number
  rules: ClassificationRule[]
  rule_count: number
}

export type StreamClassificationSummaryResponse = {
  stream_id: number
  total_rules: number
  public_count: number
  internal_count: number
  confidential_count: number
  restricted_count: number
  last_classified_at: string | null
  last_classification_level: string | null
}

export async function fetchStreamClassificationRules(
  streamId: number,
  enabledOnly = false,
): Promise<StreamClassificationRulesResponse | null> {
  const q = enabledOnly ? '?enabled_only=true' : ''
  return safeRequestJson<StreamClassificationRulesResponse>(
    `${RT}/streams/${streamId}/classification-rules${q}`,
    readJsonOpts,
  )
}

export async function fetchStreamClassificationSummary(
  streamId: number,
): Promise<StreamClassificationSummaryResponse | null> {
  return safeRequestJson<StreamClassificationSummaryResponse>(
    `${RT}/streams/${streamId}/classification/summary`,
    readJsonOpts,
  )
}

export async function createClassificationRule(
  streamId: number,
  body: {
    name: string
    enabled?: boolean
    condition_json: { sensitivity_class: string }
    classification_level: ClassificationLevel
  },
): Promise<{ rule: ClassificationRule } | null> {
  return requestJson(`${RT}/streams/${streamId}/classification-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function patchClassificationRule(
  streamId: number,
  ruleId: number,
  body: { enabled?: boolean },
): Promise<{ rule: ClassificationRule }> {
  return requestJson(`${RT}/streams/${streamId}/classification-rules/${ruleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
