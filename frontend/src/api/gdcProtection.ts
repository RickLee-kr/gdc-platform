import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type ProtectionMode = 'full_mask' | 'partial_mask' | 'hash' | 'tokenization'

export type ProtectionRule = {
  id: number
  stream_id: number
  field_path: string
  sensitivity_class: string
  protection_mode: ProtectionMode
  enabled: boolean
  source_finding_id: number | null
  created_by: string
  created_at: string
  updated_at: string
  detection_method?: string | null
  matched_rule?: string | null
}

export type StreamProtectionRulesResponse = {
  stream_id: number
  protection_enabled: boolean
  rules: ProtectionRule[]
  rule_count: number
}

export type StreamProtectionSummaryResponse = {
  stream_id: number
  protection_enabled: boolean
  enabled_rule_count: number
  disabled_rule_count: number
  full_mask_count: number
  partial_mask_count: number
  hash_count: number
  tokenization_count: number
  vault_entry_count: number
  by_mode: { full_mask: number; partial_mask: number; hash: number; tokenization: number }
  by_class: { secret: number; pii: number; security_metadata: number }
  total_rules: number
  total_protected_events: number
  total_protected_fields: number
  last_protected_at: string | null
  protection_rules: number
  protected_events: number
  protected_fields: number
}

export async function fetchStreamProtectionRules(
  streamId: number,
  enabledOnly = false,
): Promise<StreamProtectionRulesResponse | null> {
  const q = enabledOnly ? '?enabled_only=true' : ''
  return safeRequestJson<StreamProtectionRulesResponse>(
    `${RT}/streams/${streamId}/protection-rules${q}`,
    readJsonOpts,
  )
}

export async function fetchStreamProtectionSummary(
  streamId: number,
): Promise<StreamProtectionSummaryResponse | null> {
  return safeRequestJson<StreamProtectionSummaryResponse>(
    `${RT}/streams/${streamId}/protection/summary`,
    readJsonOpts,
  )
}

export async function createProtectionRule(
  streamId: number,
  body: {
    field_path: string
    sensitivity_class: string
    protection_mode: ProtectionMode
    source_finding_id: number
    enabled?: boolean
  },
): Promise<{ rule: ProtectionRule } | null> {
  return requestJson(`${RT}/streams/${streamId}/protection-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function patchProtectionRule(
  streamId: number,
  ruleId: number,
  body: { protection_mode?: ProtectionMode; enabled?: boolean },
): Promise<{ rule: ProtectionRule } | null> {
  return requestJson(`${RT}/streams/${streamId}/protection-rules/${ruleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function resolveSensitiveFinding(
  streamId: number,
  findingId: number,
  resolution: 'false_positive' | 'protection_applied',
  note?: string,
): Promise<{ id: number; status: string; resolution?: string | null } | null> {
  return requestJson(`${RT}/streams/${streamId}/sensitive-findings/${findingId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note?.trim() ? { resolution, note: note.trim() } : { resolution }),
  })
}

export type IdentityVaultSummaryResponse = {
  vault_entries: number
  stream_count: number
  last_created_at: string | null
}

export async function fetchIdentityVaultSummary(): Promise<IdentityVaultSummaryResponse | null> {
  return safeRequestJson<IdentityVaultSummaryResponse>(
    `${RT}/protection/vault/summary`,
    readJsonOpts,
  )
}

export function defaultProtectionModeForClass(sensitivityClass: string): ProtectionMode {
  switch (sensitivityClass) {
    case 'pii':
      return 'partial_mask'
    case 'secret':
    case 'security_metadata':
      return 'full_mask'
    default:
      return 'full_mask'
  }
}

export function wizardProtectionActionToMode(
  action: 'mask_partial' | 'mask_full' | 'tokenize' | 'hash',
): ProtectionMode {
  switch (action) {
    case 'mask_partial':
      return 'partial_mask'
    case 'mask_full':
      return 'full_mask'
    case 'tokenize':
      return 'tokenization'
    case 'hash':
      return 'hash'
    default:
      return 'partial_mask'
  }
}

export type ProtectionRuleDirectEntry = {
  field_path: string
  sensitivity_class: string
  protection_mode: ProtectionMode
  enabled?: boolean
}

export type ProtectionRuleDirectSkipEntry = {
  field_path: string
  reason: string
  existing_rule_id: number | null
}

export type ProtectionRuleDirectBulkResponse = {
  stream_id: number
  created: number
  updated: number
  skipped: ProtectionRuleDirectSkipEntry[]
  rules: ProtectionRule[]
}

export async function createProtectionRulesDirect(
  streamId: number,
  body: { origin: 'wizard'; rules: ProtectionRuleDirectEntry[] },
): Promise<ProtectionRuleDirectBulkResponse> {
  return requestJson(`${RT}/streams/${streamId}/protection-rules/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
