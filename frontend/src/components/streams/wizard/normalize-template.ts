/**
 * Client-side Normalize preview (mirrors backend normalize_rule operations).
 */

export type NormalizeOperation =
  | 'trim'
  | 'lowercase'
  | 'uppercase'
  | 'remove_domain'
  | 'extract_domain'
  | 'normalize_hostname'
  | 'normalize_email'
  | 'normalize_username'
  | 'remove_whitespace'
  | 'replace_empty_with_null'
  | 'iso8601'

export type NormalizeOnFailure = 'keep_original' | 'set_null' | 'drop_field' | 'skip_event'

export const NORMALIZE_OPERATION_OPTIONS: ReadonlyArray<{
  value: NormalizeOperation
  label: string
}> = [
  { value: 'trim', label: 'Trim' },
  { value: 'lowercase', label: 'Lowercase' },
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'remove_whitespace', label: 'Remove Whitespace' },
  { value: 'replace_empty_with_null', label: 'Replace Empty With Null' },
  { value: 'normalize_email', label: 'Normalize Email' },
  { value: 'normalize_username', label: 'Normalize Username' },
  { value: 'normalize_hostname', label: 'Normalize Hostname' },
  { value: 'extract_domain', label: 'Extract Domain' },
  { value: 'remove_domain', label: 'Remove Domain' },
  { value: 'iso8601', label: 'ISO 8601 (legacy)' },
]

export const NORMALIZE_ON_FAILURE_OPTIONS: ReadonlyArray<{
  value: NormalizeOnFailure
  label: string
}> = [
  { value: 'keep_original', label: 'Keep Original' },
  { value: 'set_null', label: 'Set Null' },
  { value: 'drop_field', label: 'Drop Field' },
  { value: 'skip_event', label: 'Skip Event' },
]

const ALLOWED = new Set(NORMALIZE_OPERATION_OPTIONS.map((o) => o.value))

export function parseNormalizeOperation(raw: unknown): NormalizeOperation {
  const key = String(raw ?? 'trim')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  const aliases: Record<string, NormalizeOperation> = {
    iso_8601: 'iso8601',
    lower: 'lowercase',
    upper: 'uppercase',
    strip: 'trim',
  }
  const resolved = (aliases[key] ?? key) as NormalizeOperation
  return ALLOWED.has(resolved) ? resolved : 'trim'
}

function asText(raw: unknown): string {
  if (raw == null) return ''
  return String(raw)
}

export function normalizeOperationLabel(operation: NormalizeOperation): string {
  return NORMALIZE_OPERATION_OPTIONS.find((o) => o.value === operation)?.label ?? operation
}

export type NormalizePreviewResult = {
  before: unknown
  after: unknown
  warning: string | null
}

/** Preview with UI-facing unavailable messages (Union Schema / sample driven). */
export function previewNormalizeRule(opts: {
  raw: unknown
  operation: NormalizeOperation
}): NormalizePreviewResult {
  const { raw, operation } = opts
  if (raw === undefined || raw === null || raw === '') {
    return {
      before: raw ?? null,
      after: null,
      warning: 'Preview unavailable: No sample value is available for the selected source field.',
    }
  }
  const { value, warning } = previewNormalize(raw, operation)
  if (warning) {
    const label = normalizeOperationLabel(parseNormalizeOperation(operation))
    return {
      before: raw,
      after: null,
      warning: `Preview unavailable: The selected value cannot be processed by ${label}.`,
    }
  }
  return { before: raw, after: value, warning: null }
}

export function previewNormalize(
  raw: unknown,
  operation: NormalizeOperation,
): { value: unknown; warning: string | null } {
  if (raw === undefined) return { value: null, warning: 'Source field missing in sample' }
  try {
    const op = parseNormalizeOperation(operation)

    if (op === 'replace_empty_with_null') {
      const text = asText(raw)
      if (text.trim() === '') return { value: null, warning: null }
      return { value: typeof raw === 'string' ? text : raw, warning: null }
    }

    const text = asText(raw)

    if (op === 'trim') return { value: text.trim(), warning: null }
    if (op === 'lowercase') return { value: text.toLowerCase(), warning: null }
    if (op === 'uppercase') return { value: text.toUpperCase(), warning: null }
    if (op === 'remove_whitespace') return { value: text.replace(/\s+/g, ''), warning: null }

    if (op === 'normalize_email') {
      const cleaned = text.trim().toLowerCase()
      if (!cleaned) throw new Error('Empty value cannot normalize_email')
      if (!cleaned.includes('@')) throw new Error(`Value is not an email: ${String(raw)}`)
      const [local, domain] = cleaned.split('@')
      if (!local || !domain) throw new Error(`Invalid email: ${String(raw)}`)
      return { value: `${local}@${domain}`, warning: null }
    }

    if (op === 'normalize_username') {
      const cleaned = text.trim()
      if (!cleaned) throw new Error('Empty value cannot normalize_username')
      if (cleaned.includes('\\')) return { value: cleaned.split('\\').pop()!.trim(), warning: null }
      if (cleaned.includes('@')) {
        const at = cleaned.indexOf('@')
        return { value: cleaned.slice(0, at).trim(), warning: null }
      }
      return { value: cleaned, warning: null }
    }

    if (op === 'normalize_hostname') {
      const cleaned = text.trim().toLowerCase().replace(/\.+$/, '')
      if (!cleaned) throw new Error('Empty value cannot normalize_hostname')
      const dot = cleaned.indexOf('.')
      return { value: dot === -1 ? cleaned : cleaned.slice(0, dot), warning: null }
    }

    if (op === 'extract_domain') {
      const cleaned = text.trim()
      const at = cleaned.indexOf('@')
      if (at < 0) throw new Error(`Cannot extract_domain from ${String(raw)}`)
      const domain = cleaned.slice(at + 1).trim().toLowerCase()
      if (!domain) throw new Error(`Cannot extract_domain from ${String(raw)}`)
      return { value: domain, warning: null }
    }

    if (op === 'remove_domain') {
      const cleaned = text.trim()
      const at = cleaned.indexOf('@')
      if (at >= 0) {
        const local = cleaned.slice(0, at).trim()
        if (!local) throw new Error(`Cannot remove_domain from ${String(raw)}`)
        return { value: local, warning: null }
      }
      if (cleaned.includes('\\')) return { value: cleaned.split('\\').pop()!.trim(), warning: null }
      throw new Error(`Cannot remove_domain from ${String(raw)}`)
    }

    if (op === 'iso8601') {
      const cleaned = text.trim()
      if (!cleaned) throw new Error('Empty value cannot convert to iso8601')
      const d = new Date(cleaned)
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${String(raw)}`)
      return { value: d.toISOString(), warning: null }
    }

    return { value: raw, warning: null }
  } catch (e) {
    return { value: null, warning: e instanceof Error ? e.message : String(e) }
  }
}
