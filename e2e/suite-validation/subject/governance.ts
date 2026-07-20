import crypto from 'node:crypto'

export type GovernancePolicy = {
  schema_fields: string[]
  schema_drift: 'allow' | 'warn' | 'block'
  unknown_field: 'pass_through' | 'drop' | 'block'
  confidential_detection: boolean
  sensitive_fields?: string[]
  protection?: 'none' | 'mask_partial' | 'mask_full' | 'tokenize' | 'hash' | 'remove' | 'quarantine' | 'block'
}

export type GovernanceResult = {
  event: Record<string, unknown> | null
  action: 'deliver' | 'quarantine' | 'block'
  warnings: string[]
  dropped_fields: string[]
  reasons: string[]
}

function isSensitiveValue(v: unknown): boolean {
  if (typeof v !== 'string') return false
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(v)) return true
  if (/\b(?:\d[ -]*?){13,16}\b/.test(v)) return true
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(v)) return true
  return false
}

export function maskPartial(v: string): string {
  if (v.length <= 4) return '****'
  return `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
}

export function maskFull(_v: string): string {
  return '********'
}

export function tokenize(v: string): string {
  return `tok_${crypto.createHash('sha256').update(`tokenize:${v}`).digest('hex').slice(0, 16)}`
}

export function hashValue(v: string): string {
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex')
}

export function applyGovernance(
  event: Record<string, unknown>,
  policy: GovernancePolicy,
): GovernanceResult {
  const warnings: string[] = []
  const dropped_fields: string[] = []
  const reasons: string[] = []
  const allowed = new Set(policy.schema_fields)
  const keys = Object.keys(event)
  const unknown = keys.filter((k) => !allowed.has(k))

  if (unknown.length) {
    if (policy.schema_drift === 'block') {
      return {
        event: null,
        action: 'block',
        warnings,
        dropped_fields,
        reasons: ['schema_drift_block', ...unknown.map((u) => `unknown:${u}`)],
      }
    }
    if (policy.schema_drift === 'warn') warnings.push(`schema_drift_warn:${unknown.join(',')}`)
  }

  let working: Record<string, unknown> = { ...event }

  if (unknown.length && policy.unknown_field === 'block') {
    return {
      event: null,
      action: 'block',
      warnings,
      dropped_fields,
      reasons: ['unknown_field_block', ...unknown.map((u) => `unknown:${u}`)],
    }
  }

  if (unknown.length && policy.unknown_field === 'drop') {
    for (const u of unknown) {
      delete working[u]
      dropped_fields.push(u)
    }
  }

  const sensitiveFields = new Set(policy.sensitive_fields || [])
  let detected = false
  if (policy.confidential_detection) {
    for (const [k, v] of Object.entries(working)) {
      if (sensitiveFields.has(k) || isSensitiveValue(v)) {
        detected = true
        sensitiveFields.add(k)
      }
    }
  }

  const protection = policy.protection || 'none'
  if (detected || protection !== 'none') {
    if (protection === 'block') {
      return { event: null, action: 'block', warnings, dropped_fields, reasons: ['protection_block'] }
    }
    if (protection === 'quarantine') {
      return {
        event: working,
        action: 'quarantine',
        warnings,
        dropped_fields,
        reasons: ['protection_quarantine'],
      }
    }
    for (const f of sensitiveFields) {
      const cur = working[f]
      if (typeof cur !== 'string') continue
      if (protection === 'mask_partial') working[f] = maskPartial(cur)
      else if (protection === 'mask_full') working[f] = maskFull(cur)
      else if (protection === 'tokenize') working[f] = tokenize(cur)
      else if (protection === 'hash') working[f] = hashValue(cur)
      else if (protection === 'remove') {
        delete working[f]
        dropped_fields.push(f)
      }
    }
  }

  return { event: working, action: 'deliver', warnings, dropped_fields, reasons }
}
