import type { WizardSensitivityClass, WizardState } from './wizard-state'

const SECRET_LEAF_HINTS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'private_key',
  'client_secret',
  'authorization',
  'auth',
  'credential',
  'session',
  'cookie',
])

const PII_LEAF_HINTS = new Set([
  'email',
  'e_mail',
  'phone',
  'mobile',
  'ssn',
  'social_security',
  'name',
  'first_name',
  'last_name',
  'fullname',
  'full_name',
  'address',
  'zip',
  'postal',
  'dob',
  'birth',
  'ip',
  'user_id',
  'customer_id',
])

const SECURITY_METADATA_LEAF_HINTS = new Set(['role', 'permission', 'scope', 'group', 'tenant', 'org_id'])

function leafSegment(fieldPath: string): string {
  const trimmed = fieldPath.trim()
  const leaf = trimmed.split('.').pop() ?? trimmed
  return leaf.replace(/\[\d+\]/g, '').replace(/^\$\.?/, '').toLowerCase()
}

export function inferWizardSensitivityClass(fieldPath: string): WizardSensitivityClass {
  const leaf = leafSegment(fieldPath)
  if (!leaf) return 'pii'
  if (SECRET_LEAF_HINTS.has(leaf)) return 'secret'
  for (const hint of SECRET_LEAF_HINTS) {
    if (leaf.includes(hint)) return 'secret'
  }
  if (SECURITY_METADATA_LEAF_HINTS.has(leaf)) return 'security_metadata'
  for (const hint of SECURITY_METADATA_LEAF_HINTS) {
    if (leaf.includes(hint)) return 'security_metadata'
  }
  if (PII_LEAF_HINTS.has(leaf)) return 'pii'
  for (const hint of PII_LEAF_HINTS) {
    if (leaf.includes(hint)) return 'pii'
  }
  return 'pii'
}

export function normalizeWizardDetectedField(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('$')) return trimmed
  return `$.${trimmed}`
}

/** Candidate detected fields from sample preview and transform output names. */
export function collectWizardDetectedFieldCandidates(state: WizardState): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (raw: string) => {
    const normalized = normalizeWizardDetectedField(raw)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const path of state.apiTest.analysis?.flatPreviewFields ?? []) {
    push(path)
  }
  for (const row of state.mapping) {
    if (row.sourceJsonPath.trim()) push(row.sourceJsonPath)
    if (row.outputField.trim()) push(`$.${row.outputField.trim()}`)
  }
  for (const rule of state.transformRules) {
    if (rule.outputField.trim()) push(`$.${rule.outputField.trim()}`)
  }
  for (const row of state.enrichment) {
    if (row.fieldName.trim()) push(`$.${row.fieldName.trim()}`)
  }

  return out.sort((a, b) => a.localeCompare(b))
}

export function suggestLikelySensitiveFields(candidates: readonly string[]): string[] {
  return candidates.filter((path) => {
    const leaf = leafSegment(path)
    if (SECRET_LEAF_HINTS.has(leaf) || PII_LEAF_HINTS.has(leaf) || SECURITY_METADATA_LEAF_HINTS.has(leaf)) {
      return true
    }
    return [...SECRET_LEAF_HINTS, ...PII_LEAF_HINTS, ...SECURITY_METADATA_LEAF_HINTS].some((hint) =>
      leaf.includes(hint),
    )
  })
}

export function sensitivityClassLabel(sensitivityClass: WizardSensitivityClass): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'Secret'
    case 'security_metadata':
      return 'Security metadata'
    default:
      return 'Personal data'
  }
}
