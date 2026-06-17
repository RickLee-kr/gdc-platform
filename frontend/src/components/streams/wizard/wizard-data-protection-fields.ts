import { evaluateUnionFieldSuggestion } from '../../../utils/evaluateUnionFieldSuggestion'
import type { WizardSensitivityClass, WizardState } from './wizard-state'
import {
  collectWizardProtectionFieldCandidatesSync,
  collectWizardProtectionFieldSamplesSync,
} from './wizard-data-protection-path-resolve'

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

/** Candidate detected fields from the runtime enriched event preview (mapping + enrichment). */
export function collectWizardDetectedFieldCandidates(state: WizardState): string[] {
  return collectWizardProtectionFieldCandidatesSync(state)
}

export function suggestLikelySensitiveFields(
  candidates: readonly string[],
  sampleValuesByPath?: ReadonlyMap<string, readonly unknown[]>,
): string[] {
  return candidates.filter((path) => {
    const samples = sampleValuesByPath?.get(path)
    return evaluateUnionFieldSuggestion(path, undefined, samples).sensitive
  })
}

export function suggestLikelySensitiveFieldsFromState(state: WizardState): string[] {
  const candidates = collectWizardDetectedFieldCandidates(state)
  const sampleValuesByPath = collectWizardProtectionFieldSamplesSync(state)
  return suggestLikelySensitiveFields(candidates, sampleValuesByPath)
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
