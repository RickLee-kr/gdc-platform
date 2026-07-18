/**
 * Client-side type conversion preview (mirrors backend coerce rules).
 */

export type TypeConversionTargetType =
  | 'string'
  | 'integer'
  | 'long'
  | 'float'
  | 'double'
  | 'boolean'
  | 'datetime'
  | 'array'
  | 'object'
  | 'json'

export type TypeConversionOnFailure = 'keep_original' | 'set_null' | 'drop_field' | 'skip_event'

export const TYPE_CONVERSION_TARGET_OPTIONS: ReadonlyArray<{
  value: TypeConversionTargetType
  label: string
}> = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'long', label: 'Long' },
  { value: 'float', label: 'Float' },
  { value: 'double', label: 'Double' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'datetime', label: 'DateTime' },
  { value: 'array', label: 'Array' },
  { value: 'object', label: 'Object' },
  { value: 'json', label: 'JSON' },
]

export const TYPE_CONVERSION_ON_FAILURE_OPTIONS: ReadonlyArray<{
  value: TypeConversionOnFailure
  label: string
}> = [
  { value: 'keep_original', label: 'Keep Original' },
  { value: 'set_null', label: 'Set Null' },
  { value: 'drop_field', label: 'Drop Field' },
  { value: 'skip_event', label: 'Skip Event' },
]

const TRUE_STRINGS = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSE_STRINGS = new Set(['false', '0', 'no', 'n', 'off'])

function normalizeTargetType(raw: string): TypeConversionTargetType {
  const key = raw.trim().toLowerCase().replace(/-/g, '_')
  const aliases: Record<string, TypeConversionTargetType> = {
    str: 'string',
    int: 'integer',
    bool: 'boolean',
    list: 'array',
    dict: 'object',
    map: 'object',
  }
  const resolved = aliases[key] ?? (key as TypeConversionTargetType)
  if (!TYPE_CONVERSION_TARGET_OPTIONS.some((o) => o.value === resolved)) {
    throw new Error(`Unsupported target type ${raw}`)
  }
  return resolved
}

function toBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  const text = String(raw).trim().toLowerCase()
  if (TRUE_STRINGS.has(text)) return true
  if (FALSE_STRINGS.has(text)) return false
  throw new Error(`Cannot convert ${String(raw)} to boolean`)
}

function toInteger(raw: unknown): number {
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  const text = String(raw).trim()
  if (!text) throw new Error('Empty value cannot convert to integer')
  const n = Number(text)
  if (!Number.isFinite(n)) throw new Error(`Cannot convert ${text} to integer`)
  return Math.trunc(n)
}

function toFloat(raw: unknown): number {
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const text = String(raw).trim()
  if (!text) throw new Error('Empty value cannot convert to float')
  const n = Number(text)
  if (!Number.isFinite(n)) throw new Error(`Cannot convert ${text} to float`)
  return n
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('JSON value is not an array')
    return parsed
  }
  throw new Error(`Cannot convert ${typeof raw} to array`)
}

function toObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON value is not an object')
    }
    return parsed as Record<string, unknown>
  }
  throw new Error(`Cannot convert ${typeof raw} to object`)
}

export function previewTypeConversion(
  raw: unknown,
  targetType: TypeConversionTargetType,
): { value: unknown; warning: string | null } {
  if (raw === undefined) return { value: null, warning: 'Source field missing in sample' }
  try {
    const tt = normalizeTargetType(targetType)
    if (raw === null) {
      if (tt === 'string') return { value: '', warning: null }
      if (tt === 'array') return { value: [], warning: null }
      if (tt === 'object') return { value: {}, warning: null }
      throw new Error('Cannot convert null')
    }
    if (tt === 'string') {
      if (typeof raw === 'object') return { value: JSON.stringify(raw), warning: null }
      return { value: String(raw), warning: null }
    }
    if (tt === 'integer' || tt === 'long') return { value: toInteger(raw), warning: null }
    if (tt === 'float' || tt === 'double') return { value: toFloat(raw), warning: null }
    if (tt === 'boolean') return { value: toBoolean(raw), warning: null }
    if (tt === 'datetime') {
      if (typeof raw === 'string' && raw.trim()) return { value: raw.trim(), warning: null }
      if (typeof raw === 'number') return { value: new Date(raw).toISOString(), warning: null }
      throw new Error('Invalid datetime value')
    }
    if (tt === 'array') return { value: toArray(raw), warning: null }
    if (tt === 'object') return { value: toObject(raw), warning: null }
    if (tt === 'json') {
      if (typeof raw === 'string') return { value: JSON.parse(raw), warning: null }
      return { value: raw, warning: null }
    }
    return { value: raw, warning: null }
  } catch (e) {
    return { value: null, warning: e instanceof Error ? e.message : String(e) }
  }
}
