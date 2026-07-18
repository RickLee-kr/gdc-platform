/**
 * Client-side Timestamp Conversion helpers (mirrors backend enums + preview).
 */

export type TimestampInputFormat =
  | 'unix_s'
  | 'unix_ms'
  | 'unix_us'
  | 'unix_ns'
  | 'iso8601'
  | 'rfc3339'
  | 'auto'

export type TimestampOutputFormat =
  | 'utc_iso8601'
  | 'unix_s'
  | 'unix_ms'
  | 'unix_us'
  | 'unix_ns'
  | 'rfc3339'

export type TimestampTimezoneMode = 'utc' | 'source' | 'custom'
export type TimestampOnFailure = 'keep_original' | 'set_null' | 'drop_field' | 'skip_event'

/** Primary Input Format menu — labels match product UI; values are runtime enums. */
export const TIMESTAMP_INPUT_FORMAT_OPTIONS: ReadonlyArray<{ value: TimestampInputFormat; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'unix_s', label: 'Unix Seconds' },
  { value: 'unix_ms', label: 'Unix Milliseconds' },
  { value: 'unix_us', label: 'Unix Microseconds' },
  { value: 'unix_ns', label: 'Unix Nanoseconds' },
  { value: 'iso8601', label: 'ISO 8601 / RFC 3339' },
]

/** Extra option kept for hydrate when a rule was saved as rfc3339. */
export const TIMESTAMP_INPUT_FORMAT_RFC3339_OPTION: { value: TimestampInputFormat; label: string } = {
  value: 'rfc3339',
  label: 'RFC 3339',
}

/** Primary Output Format menu. */
export const TIMESTAMP_OUTPUT_FORMAT_OPTIONS: ReadonlyArray<{ value: TimestampOutputFormat; label: string }> = [
  { value: 'utc_iso8601', label: 'UTC ISO 8601' },
  { value: 'unix_s', label: 'Unix Seconds' },
  { value: 'unix_ms', label: 'Unix Milliseconds' },
  { value: 'unix_us', label: 'Unix Microseconds' },
  { value: 'unix_ns', label: 'Unix Nanoseconds' },
]

export const TIMESTAMP_OUTPUT_FORMAT_RFC3339_OPTION: { value: TimestampOutputFormat; label: string } = {
  value: 'rfc3339',
  label: 'RFC 3339',
}

export const TIMESTAMP_TIMEZONE_OPTIONS: ReadonlyArray<{ value: TimestampTimezoneMode; label: string }> = [
  { value: 'utc', label: 'UTC' },
  { value: 'source', label: 'Source Timezone' },
  { value: 'custom', label: 'Custom Timezone' },
]

export const TIMESTAMP_ON_FAILURE_OPTIONS: ReadonlyArray<{ value: TimestampOnFailure; label: string }> = [
  { value: 'keep_original', label: 'Keep Original' },
  { value: 'set_null', label: 'Set Null' },
  { value: 'drop_field', label: 'Drop Field' },
  { value: 'skip_event', label: 'Skip Event' },
]

const UNIX_S_MAX = 1e11
const UNIX_MS_MAX = 1e14
const UNIX_US_MAX = 1e17

export function inputFormatOptionsForValue(current: TimestampInputFormat): ReadonlyArray<{
  value: TimestampInputFormat
  label: string
}> {
  if (current === 'rfc3339') {
    return [...TIMESTAMP_INPUT_FORMAT_OPTIONS, TIMESTAMP_INPUT_FORMAT_RFC3339_OPTION]
  }
  return TIMESTAMP_INPUT_FORMAT_OPTIONS
}

export function outputFormatOptionsForValue(current: TimestampOutputFormat): ReadonlyArray<{
  value: TimestampOutputFormat
  label: string
}> {
  if (current === 'rfc3339') {
    return [...TIMESTAMP_OUTPUT_FORMAT_OPTIONS, TIMESTAMP_OUTPUT_FORMAT_RFC3339_OPTION]
  }
  return TIMESTAMP_OUTPUT_FORMAT_OPTIONS
}

/** Convert Union Schema `$.a.b` path to runtime `source_field` (`a.b`). */
export function unionPathToSourceField(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed === '$') return ''
  return trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed.startsWith('$') ? trimmed.slice(1) : trimmed
}

/** Match a stored source_field against a Union Schema field_path. */
export function sourceFieldMatchesUnionPath(sourceField: string, fieldPath: string): boolean {
  const a = unionPathToSourceField(sourceField).toLowerCase()
  const b = unionPathToSourceField(fieldPath).toLowerCase()
  return Boolean(a) && a === b
}

function jsonataFieldRef(path: string): string {
  const key = path.trim()
  if (!key) return 'null'
  if (!key.includes('.') && (key.startsWith('@') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    return `$lookup($, "${key}")`
  }
  return key
    .split('.')
    .map((part, idx) => {
      if (idx === 0) return part
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `."${part}"`
    })
    .join('')
}

export function buildTimestampJsonataTemplate(opts: {
  sourceField: string
  inputFormat: TimestampInputFormat
  outputFormat: TimestampOutputFormat
}): string {
  const src = jsonataFieldRef(opts.sourceField || 'event_time')
  const inp = opts.inputFormat
  const out = opts.outputFormat

  let millisExpr: string
  if (inp === 'unix_s') millisExpr = `$number(${src}) * 1000`
  else if (inp === 'unix_ms') millisExpr = `$number(${src})`
  else if (inp === 'unix_us') millisExpr = `$number(${src}) / 1000`
  else if (inp === 'unix_ns') millisExpr = `$number(${src}) / 1000000`
  else if (inp === 'iso8601' || inp === 'rfc3339') millisExpr = `$toMillis(${src})`
  else {
    millisExpr =
      `($n := $number(${src}); ` +
      `$n < 1e11 ? $n * 1000 : $n < 1e14 ? $n : $n < 1e17 ? $n / 1000 : $n / 1000000)`
  }

  if (out === 'utc_iso8601' || out === 'rfc3339') return `$fromMillis(${millisExpr})`
  if (out === 'unix_s') return `$floor((${millisExpr}) / 1000)`
  if (out === 'unix_ms') return `$floor(${millisExpr})`
  if (out === 'unix_us') return `$floor((${millisExpr}) * 1000)`
  if (out === 'unix_ns') return `$floor((${millisExpr}) * 1000000)`
  return `$fromMillis(${millisExpr})`
}

/** Formats considered identical for validation warning. */
export function timestampFormatsEquivalent(
  inputFormat: TimestampInputFormat,
  outputFormat: TimestampOutputFormat,
): boolean {
  if (inputFormat === 'auto') return false
  const pairs: Array<[TimestampInputFormat, TimestampOutputFormat]> = [
    ['iso8601', 'utc_iso8601'],
    ['iso8601', 'rfc3339'],
    ['rfc3339', 'utc_iso8601'],
    ['rfc3339', 'rfc3339'],
    ['unix_s', 'unix_s'],
    ['unix_ms', 'unix_ms'],
    ['unix_us', 'unix_us'],
    ['unix_ns', 'unix_ns'],
  ]
  return pairs.some(([a, b]) => a === inputFormat && b === outputFormat)
}

function formatLabel(fmt: TimestampInputFormat | TimestampOutputFormat): string {
  const input = TIMESTAMP_INPUT_FORMAT_OPTIONS.find((o) => o.value === fmt)
  if (input) return input.label
  if (fmt === 'rfc3339') return 'RFC 3339'
  const output = TIMESTAMP_OUTPUT_FORMAT_OPTIONS.find((o) => o.value === fmt)
  if (output) return output.label
  return String(fmt)
}

function toFloat(raw: unknown): number {
  if (typeof raw === 'boolean') throw new Error('Boolean is not a valid timestamp')
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const text = String(raw).trim()
  if (!text) throw new Error('Empty timestamp value')
  const n = Number(text)
  if (!Number.isFinite(n)) throw new Error(`Not a numeric timestamp: ${String(raw)}`)
  return n
}

function fromEpochSeconds(seconds: number): Date {
  const ms = seconds * 1000
  if (!Number.isFinite(ms)) throw new Error(`Epoch out of range: ${seconds}`)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) throw new Error(`Epoch out of range: ${seconds}`)
  return d
}

function parseIsoLike(raw: unknown): Date {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) throw new Error('Invalid date')
    return raw
  }
  const text = String(raw).trim()
  if (!text) throw new Error('Empty timestamp string')
  let normalized = text.replace(' ', 'T')
  if (normalized.endsWith('Z')) normalized = `${normalized.slice(0, -1)}+00:00`
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO/RFC3339 timestamp: ${text}`)
  return d
}

function autoDetect(raw: unknown): Date {
  if (raw instanceof Date) return parseIsoLike(raw)
  if (typeof raw === 'number' || (typeof raw === 'string' && /^[+-]?\d+(\.\d+)?$/.test(raw.trim()))) {
    const n = Math.abs(toFloat(raw))
    if (n < UNIX_S_MAX) return fromEpochSeconds(toFloat(raw))
    if (n < UNIX_MS_MAX) return fromEpochSeconds(toFloat(raw) / 1000)
    if (n < UNIX_US_MAX) return fromEpochSeconds(toFloat(raw) / 1_000_000)
    return fromEpochSeconds(toFloat(raw) / 1_000_000_000)
  }
  return parseIsoLike(raw)
}

function parseToDate(
  raw: unknown,
  inputFormat: TimestampInputFormat,
  timezoneIana: string | null,
): Date {
  let dt: Date
  if (inputFormat === 'unix_s') dt = fromEpochSeconds(toFloat(raw))
  else if (inputFormat === 'unix_ms') dt = fromEpochSeconds(toFloat(raw) / 1000)
  else if (inputFormat === 'unix_us') dt = fromEpochSeconds(toFloat(raw) / 1_000_000)
  else if (inputFormat === 'unix_ns') dt = fromEpochSeconds(toFloat(raw) / 1_000_000_000)
  else if (inputFormat === 'iso8601' || inputFormat === 'rfc3339') dt = parseIsoLike(raw)
  else dt = autoDetect(raw)

  // Naive ISO strings are interpreted in the selected zone when custom; otherwise UTC.
  if (timezoneIana && timezoneIana !== 'UTC') {
    // Browser Date is always absolute; formatting uses UTC output below.
    return dt
  }
  return dt
}

function formatOutput(dt: Date, outputFormat: TimestampOutputFormat): unknown {
  const ms = dt.getTime()
  if (outputFormat === 'utc_iso8601' || outputFormat === 'rfc3339') {
    return new Date(ms).toISOString()
  }
  const epoch = ms / 1000
  if (outputFormat === 'unix_s') return Number.isInteger(epoch) ? epoch : epoch
  if (outputFormat === 'unix_ms') return Math.round(ms)
  if (outputFormat === 'unix_us') return Math.round(ms * 1000)
  if (outputFormat === 'unix_ns') return Math.round(ms * 1_000_000)
  return new Date(ms).toISOString()
}

export type TimestampPreviewResult = {
  before: unknown
  after: unknown
  warning: string | null
}

/**
 * Client-side Before → After preview using a sample value (Union Schema sample_values).
 */
export function previewTimestampConversion(opts: {
  raw: unknown
  inputFormat: TimestampInputFormat
  outputFormat: TimestampOutputFormat
  timezoneIana?: string | null
}): TimestampPreviewResult {
  const { raw, inputFormat, outputFormat } = opts
  const timezoneIana = opts.timezoneIana?.trim() || 'UTC'
  if (raw === undefined || raw === null || raw === '') {
    return { before: raw ?? null, after: null, warning: 'Preview unavailable: No sample value for the selected Source Field.' }
  }
  try {
    const dt = parseToDate(raw, inputFormat, timezoneIana)
    const after = formatOutput(dt, outputFormat)
    return { before: raw, after, warning: null }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    const matchHint =
      inputFormat !== 'auto'
        ? `Selected value does not match ${formatLabel(inputFormat)}.`
        : reason
    return {
      before: raw,
      after: null,
      warning: `Preview unavailable: ${matchHint}`,
    }
  }
}

/** Sentinel selection value for timezone.mode = "source" (not an IANA name). */
export const TIMESTAMP_SOURCE_TIMEZONE_VALUE = '__source__'

/**
 * Combobox selection value for Timestamp Conversion timezone fields.
 * - source → TIMESTAMP_SOURCE_TIMEZONE_VALUE
 * - utc → "UTC"
 * - custom → IANA name
 */
export function timestampTimezoneSelectionValue(
  mode: TimestampTimezoneMode,
  customTimezone: string,
): string {
  if (mode === 'source') return TIMESTAMP_SOURCE_TIMEZONE_VALUE
  if (mode === 'custom') {
    const iana = customTimezone.trim()
    return iana || 'UTC'
  }
  return 'UTC'
}

/** @deprecated Prefer timestampTimezoneSelectionValue — kept for preview IANA resolution. */
export function timestampTimezoneToIana(
  mode: TimestampTimezoneMode,
  customTimezone: string,
): string {
  if (mode === 'custom') {
    const iana = customTimezone.trim()
    return iana || 'UTC'
  }
  // Preview treats source/utc as UTC absolute for display purposes only.
  return 'UTC'
}

/**
 * Apply timezone combobox selection onto wizard fields (storage structure unchanged).
 * Source Timezone → { mode: "source" }
 * UTC → { mode: "utc" }
 * Asia/Seoul → { mode: "custom", iana: "Asia/Seoul" }
 */
export function applyTimestampTimezoneSelection(selection: string): {
  tsTimezoneMode: TimestampTimezoneMode
  tsCustomTimezone: string
} {
  const tz = selection.trim()
  if (tz === TIMESTAMP_SOURCE_TIMEZONE_VALUE || tz.toLowerCase() === 'source') {
    return { tsTimezoneMode: 'source', tsCustomTimezone: '' }
  }
  if (!tz || tz === 'UTC') {
    return { tsTimezoneMode: 'utc', tsCustomTimezone: '' }
  }
  return { tsTimezoneMode: 'custom', tsCustomTimezone: tz }
}

/** @deprecated Use applyTimestampTimezoneSelection */
export function applyIanaTimezoneSelection(iana: string): {
  tsTimezoneMode: TimestampTimezoneMode
  tsCustomTimezone: string
} {
  return applyTimestampTimezoneSelection(iana)
}
