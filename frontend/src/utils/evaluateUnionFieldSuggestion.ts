export type UnionFieldSuggestionCategory = 'pii' | 'secret'

export type UnionFieldSuggestion = {
  sensitive: boolean
  category: UnionFieldSuggestionCategory | null
  suggestedType: string | null
}

const EMAIL_LEAF_NAMES = new Set(['email', 'e_mail'])
const API_KEY_LEAF_NAMES = new Set(['api_key', 'apikey', 'access_key', 'secret_key'])
const CREDIT_CARD_LEAF_NAMES = new Set(['credit_card', 'card_number'])
const PASSWORD_LEAF_NAMES = new Set(['password', 'passwd', 'pwd'])
const TOKEN_LEAF_NAMES = new Set(['token', 'access_token', 'refresh_token'])
const PEM_LEAF_NAMES = new Set(['private_key', 'pem'])

const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function leafSegment(fieldPath: string): string {
  const trimmed = fieldPath.trim()
  const leaf = trimmed.split('.').pop() ?? trimmed
  return leaf.replace(/\[\d+\]/g, '').replace(/^\$\.?/, '').toLowerCase()
}

function stringSamples(sampleValues: readonly unknown[] | undefined): string[] {
  if (!sampleValues?.length) return []
  return sampleValues
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

function matchesEmailSample(sampleValues: readonly unknown[] | undefined): boolean {
  return stringSamples(sampleValues).some((value) => EMAIL_VALUE_PATTERN.test(value))
}

function matchesPemSample(sampleValues: readonly unknown[] | undefined): boolean {
  return stringSamples(sampleValues).some(
    (value) => value.includes('-----BEGIN') && value.includes('-----END'),
  )
}

type NameMatch = {
  category: UnionFieldSuggestionCategory
  suggestedType: string
}

function matchByFieldName(leaf: string): NameMatch | null {
  if (EMAIL_LEAF_NAMES.has(leaf)) {
    return { category: 'pii', suggestedType: 'Likely Email' }
  }
  if (API_KEY_LEAF_NAMES.has(leaf)) {
    return { category: 'secret', suggestedType: 'Likely API Key' }
  }
  if (CREDIT_CARD_LEAF_NAMES.has(leaf)) {
    return { category: 'pii', suggestedType: 'Likely Credit Card' }
  }
  if (PASSWORD_LEAF_NAMES.has(leaf)) {
    return { category: 'secret', suggestedType: 'Likely Password' }
  }
  if (TOKEN_LEAF_NAMES.has(leaf)) {
    return { category: 'secret', suggestedType: 'Likely Token' }
  }
  if (PEM_LEAF_NAMES.has(leaf)) {
    return { category: 'secret', suggestedType: 'Likely Private Key' }
  }
  return null
}

function matchBySampleValue(sampleValues: readonly unknown[] | undefined): NameMatch | null {
  if (matchesEmailSample(sampleValues)) {
    return { category: 'pii', suggestedType: 'Likely Email' }
  }
  if (matchesPemSample(sampleValues)) {
    return { category: 'secret', suggestedType: 'Likely Private Key' }
  }
  return null
}

/** Union Schema sensitive suggestion — field name + sample value pattern (OSS v1). */
export function evaluateUnionFieldSuggestion(
  field_path: string,
  _field_type?: string,
  sample_values?: readonly unknown[],
): UnionFieldSuggestion {
  const leaf = leafSegment(field_path)
  const byName = leaf ? matchByFieldName(leaf) : null
  const bySample = matchBySampleValue(sample_values)

  const match = byName ?? bySample
  if (!match) {
    return { sensitive: false, category: null, suggestedType: null }
  }

  return {
    sensitive: true,
    category: match.category,
    suggestedType: match.suggestedType,
  }
}
