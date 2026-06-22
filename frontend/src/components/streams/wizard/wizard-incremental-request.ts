/**
 * Incremental Request Template Generator
 *
 * Pure helpers for the JSON Preview step's "Generate incremental request" feature.
 * Generates query-param or JSON-body templates from a selected checkpoint field
 * so the operator can apply them to the HTTP Request step.
 *
 * No backend / API contract changes: all output is pure string/array data ready
 * to drop into `WizardConfigState.params` or `requestBody`.
 */

import { parseJsonPathSegments } from '../../../utils/mappingPassThrough'
import { normalizeEventRootPath, normalizeEventArrayPath, formatPreviewSamplePath } from '../../../utils/eventExtractionPaths'
import { normalizeCheckpointRelativePath } from '../../../utils/recordSelectionPaths'
import { toExtractedEventRelativePath } from './wizard-json-extract'

export type IncrementalRequestPattern = 'none' | 'custom' | 'query_params' | 'json_body' | 'elasticsearch'

export type IncrementalRequestPlan =
  | {
      pattern: 'query_params'
      preview: string
      params: Array<{ key: string; value: string }>
      httpMethod: 'GET'
    }
  | {
      pattern: 'json_body' | 'elasticsearch'
      preview: string
      body: string
      httpMethod: 'POST'
    }

/** Extract a usable field name from a record-relative JSONPath (e.g. "$.metadata.timestamp" → "metadata.timestamp"). */
export function fieldNameFromCheckpointPath(checkpointSourcePath: string): string {
  const raw = checkpointSourcePath.trim()
  if (!raw) return ''
  return raw.replace(/^\$\.?/, '').trim()
}

/** Shorten dotted field path to a query-param-friendly prefix (last segment only). */
export function leafFieldName(checkpointSourcePath: string): string {
  const full = fieldNameFromCheckpointPath(checkpointSourcePath)
  if (!full) return ''
  const segments = full.split('.').filter(Boolean)
  return segments.length ? segments[segments.length - 1] : full
}

export function buildIncrementalRequestPlan(
  pattern: IncrementalRequestPattern,
  checkpointSourcePath: string,
): IncrementalRequestPlan | null {
  if (pattern === 'none' || pattern === 'custom') return null
  const fullField = fieldNameFromCheckpointPath(checkpointSourcePath)
  if (!fullField) return null
  const prefix = leafFieldName(checkpointSourcePath) || fullField

  if (pattern === 'query_params') {
    const params = [
      { key: `${prefix}_gt`, value: '{{checkpoint.last_timestamp}}' },
      { key: `${prefix}_lte`, value: '{{now}}' },
      { key: 'limit', value: '100' },
      { key: 'sort', value: `${prefix}:asc` },
    ]
    const preview = params.map((p) => `${p.key}=${p.value}`).join('\n')
    return { pattern, preview, params, httpMethod: 'GET' }
  }

  if (pattern === 'json_body') {
    const body = {
      from: '{{checkpoint.last_timestamp}}',
      to: '{{now}}',
      limit: 100,
      sort: [{ [fullField]: 'asc' }],
    }
    const preview = JSON.stringify(body, null, 2)
    return { pattern, preview, body: preview, httpMethod: 'POST' }
  }

  // elasticsearch
  const body = {
    size: 100,
    sort: [{ [fullField]: 'asc' }, { _id: 'asc' }],
    query: {
      range: {
        [fullField]: {
          gt: '{{checkpoint.last_timestamp}}',
          lte: '{{now}}',
        },
      },
    },
  }
  const preview = JSON.stringify(body, null, 2)
  return { pattern, preview, body: preview, httpMethod: 'POST' }
}

function segmentsToPath(segments: Array<string | number>): string {
  if (segments.length === 0) return '$'
  return segments.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`
    return acc === '$' ? `$.${seg}` : `${acc}.${seg}`
  }, '$')
}

function readValueAtJsonPathSegments(root: unknown, path: string): unknown {
  if (path.trim() === '$') return root
  const segments = parseJsonPathSegments(path)
  let cur: unknown = root
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined
    if (typeof seg === 'number') {
      if (!Array.isArray(cur) || seg < 0 || seg >= cur.length) return undefined
      cur = cur[seg]
      continue
    }
    if (Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Resolve a value inside an extracted event record by record-relative JSONPath (`$.a.b[0].c`). */
export function readCheckpointSampleValue(record: Record<string, unknown> | null, recordRelativePath: string): unknown {
  if (!record) return undefined
  const raw = recordRelativePath.trim()
  if (!raw) return record
  const path = raw.startsWith('$') ? raw : `$.${raw.replace(/^\./, '')}`
  if (path === '$') return record
  return readValueAtJsonPathSegments(record, path)
}

/**
 * Resolve a checkpoint field on an Event Source record, including fallbacks when the stored
 * checkpoint path still contains stale array prefixes (e.g. `data.results[0]`) but Event Root
 * already narrows each record to the malop object.
 */
export function readCheckpointFromEventSourceRecord(
  record: Record<string, unknown>,
  checkpointSourcePath: string,
  eventRootPath = '',
): unknown {
  const checkpointPath = normalizeCheckpointRelativePath(checkpointSourcePath)
  const direct = readCheckpointSampleValue(record, checkpointPath)
  if (!isBlankValue(direct)) return direct

  const root = normalizeEventRootPath(eventRootPath)
  if (!root) return undefined

  const rooted = readCheckpointSampleValue(record, root)
  if (!rooted || typeof rooted !== 'object' || Array.isArray(rooted)) return undefined
  const rootedRecord = rooted as Record<string, unknown>

  if (checkpointPath.startsWith(`${root}.`) || checkpointPath.startsWith(`${root}[`)) {
    const suffix = checkpointPath.slice(root.length)
    const relative = suffix.startsWith('.') || suffix.startsWith('[') ? `$${suffix}` : `$.${suffix}`
    const fromRootPrefix = readCheckpointSampleValue(rootedRecord, relative)
    if (!isBlankValue(fromRootPrefix)) return fromRootPrefix
  }

  const segments = parseJsonPathSegments(checkpointPath)
  for (let start = 1; start < segments.length; start += 1) {
    const tailValue = readValueAtJsonPathSegments(rootedRecord, segmentsToPath(segments.slice(start)))
    if (!isBlankValue(tailValue)) return tailValue
  }

  return undefined
}

/** Parse a query-params draft (one `key=value` per line) into wizard `params` rows. */
export function parseQueryParamsDraft(draft: string): Array<{ key: string; value: string }> {
  return draft
    .split(/\r?\n/)
    .map((line) => line.replace(/^[?&]/, '').trim())
    .filter(Boolean)
    .flatMap((line) =>
      line.split('&').map((pair) => {
        const eq = pair.indexOf('=')
        if (eq < 0) return { key: pair.trim(), value: '' }
        return { key: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
      }),
    )
    .filter((p) => p.key.length > 0)
}

/** Heuristic: a draft is treated as Query Params if it does not appear to be JSON ({…} or […]). */
export function looksLikeQueryParams(draft: string): boolean {
  const trimmed = draft.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false
  return true
}

/**
 * Apply an incremental-request template to an in-progress HTTP request payload.
 * Pure helper used at create-stream payload time so the user does not have to bounce
 * back to the HTTP Request step. `none`/empty drafts are no-ops.
 */
export function applyIncrementalRequestTemplate(
  base: { method: string; params: Record<string, string>; body?: string },
  pattern: IncrementalRequestPattern,
  draft: string,
): { method: string; params: Record<string, string>; body?: string } {
  const trimmed = (draft ?? '').trim()
  if (pattern === 'none' || !trimmed) return base
  const treatAsQuery = pattern === 'query_params' || (pattern === 'custom' && looksLikeQueryParams(trimmed))
  if (treatAsQuery) {
    const merged: Record<string, string> = { ...base.params }
    for (const p of parseQueryParamsDraft(trimmed)) {
      if (p.key) merged[p.key] = p.value
    }
    return { method: 'GET', params: merged, body: base.body }
  }
  return {
    method: base.method === 'GET' ? 'POST' : base.method,
    params: { ...base.params },
    body: trimmed,
  }
}

export type IncrementalRequestTestCheckpointResult =
  | {
      kind: 'ok'
      value: string | number
      displayValue: string
      usedFallback: boolean
      latestExcluded?: string
      valueKind: 'timestamp' | 'numeric'
    }
  | { kind: 'disabled'; reason: string }
  | { kind: 'unsortable_string'; reason: string }

const HOUR_MS = 3_600_000

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1e12) return Math.round(value)
    if (value >= 1e9) return Math.round(value * 1000)
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return null
      if (n >= 1e12) return Math.round(n)
      if (n >= 1e9) return Math.round(n * 1000)
      return null
    }
    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function classifyCheckpointValue(value: unknown): 'timestamp' | 'numeric' | 'string' | null {
  if (isBlankValue(value)) return null
  if (parseTimestampMs(value) != null) return 'timestamp'
  if (parseNumericValue(value) != null) return 'numeric'
  if (typeof value === 'string') return 'string'
  return null
}

/** Strip stale array/sample prefixes so checkpoint paths work on extracted records. */
export function resolveCheckpointPathForRecord(
  checkpointSourcePath: string,
  eventArrayPath: string,
): string {
  const cp = normalizeCheckpointRelativePath(checkpointSourcePath)
  if (!cp) return ''
  const arrayNorm = normalizeEventArrayPath(eventArrayPath) || '$'
  const stripPrefixes = [
    formatPreviewSamplePath(eventArrayPath, 0),
    `${arrayNorm}[0]`,
    arrayNorm,
    '$[0]',
    '$',
  ]
  for (const prefix of stripPrefixes) {
    if (!prefix) continue
    if (cp === prefix) return '$'
    if (cp.startsWith(`${prefix}.`)) {
      const rel = cp.slice(prefix.length + 1)
      return rel.startsWith('$') ? rel : `$.${rel}`
    }
  }
  return cp
}

/** Resolve checkpoint path against extracted event records (event root already applied). */
export function resolveCheckpointPathForExtractedEvent(
  checkpointSourcePath: string,
  eventArrayPath: string,
  eventRootPath: string,
): string {
  const onItem = resolveCheckpointPathForRecord(checkpointSourcePath, eventArrayPath)
  const base = onItem || normalizeCheckpointRelativePath(checkpointSourcePath)
  const root = normalizeEventRootPath(eventRootPath)
  if (!root) return base
  return toExtractedEventRelativePath(base, eventArrayPath || '$', root)
}

/** Read a checkpoint value from an extracted event record (post event-root). */
export function readCheckpointFromExtractedEvent(
  record: Record<string, unknown>,
  checkpointSourcePath: string,
  eventArrayPath: string,
  eventRootPath: string,
): unknown {
  const pathOnExtracted = resolveCheckpointPathForExtractedEvent(
    checkpointSourcePath,
    eventArrayPath,
    eventRootPath,
  )
  const direct = readCheckpointSampleValue(record, pathOnExtracted)
  if (!isBlankValue(direct)) return direct

  const leaf = leafFieldName(checkpointSourcePath)
  if (leaf) {
    const leafVal = readCheckpointSampleValue(record, `$.${leaf}`)
    if (!isBlankValue(leafVal)) return leafVal
  }

  return readCheckpointFromEventSourceRecord(
    record,
    resolveCheckpointPathForRecord(checkpointSourcePath, eventArrayPath) || checkpointSourcePath,
    eventRootPath,
  )
}

/** Collect checkpoint values for incremental Test — uses extracted records + preview fallback. */
export function collectCheckpointValuesForIncrementalTest(input: {
  records: Array<Record<string, unknown>>
  checkpointSourcePath: string
  eventArrayPath: string
  eventRootPath?: string
  previewRecord?: Record<string, unknown> | null
}): unknown[] {
  const { records, checkpointSourcePath, eventArrayPath, eventRootPath = '', previewRecord } = input
  if (!checkpointSourcePath.trim()) return []

  const readOn = (record: Record<string, unknown>) =>
    eventRootPath.trim()
      ? readCheckpointFromExtractedEvent(record, checkpointSourcePath, eventArrayPath, eventRootPath)
      : readCheckpointFromEventSourceRecord(
          record,
          resolveCheckpointPathForRecord(checkpointSourcePath, eventArrayPath) || checkpointSourcePath,
          eventRootPath,
        )

  const fromRecords = records.map(readOn).filter((value) => !isBlankValue(value))
  if (fromRecords.length) return fromRecords

  if (previewRecord) {
    const previewVal = readOn(previewRecord)
    if (!isBlankValue(previewVal)) return [previewVal]
  }

  return []
}

/** Collect checkpoint field values from Event Source records (ignores Event Root). */
export function collectCheckpointValuesFromEventSource(
  eventSourceRecords: Array<Record<string, unknown>>,
  checkpointSourcePath: string,
  eventRootPath = '',
): unknown[] {
  if (!checkpointSourcePath.trim()) return []
  return eventSourceRecords
    .map((record) => readCheckpointFromEventSourceRecord(record, checkpointSourcePath, eventRootPath))
    .filter((value) => !isBlankValue(value))
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/** Pick a safe checkpoint substitute for incremental request API tests. */
export function calculateIncrementalRequestTestCheckpoint(
  rawValues: unknown[],
  _checkpointFieldType: string,
): IncrementalRequestTestCheckpointResult {
  if (!rawValues.length) {
    return { kind: 'disabled', reason: 'Select a checkpoint field with values first.' }
  }

  const classified = rawValues.map((value) => ({ value, kind: classifyCheckpointValue(value) }))
  const kinds = new Set(classified.map((row) => row.kind).filter((k): k is 'timestamp' | 'numeric' | 'string' => k != null))
  if (kinds.size === 1 && kinds.has('string')) {
    return {
      kind: 'unsortable_string',
      reason: 'Cannot calculate a safe test checkpoint from this field.',
    }
  }

  const timestampMs = classified
    .map((row) => parseTimestampMs(row.value))
    .filter((ms): ms is number => ms != null)
  if (timestampMs.length) {
    const sorted = uniqueSortedNumbers(timestampMs)
    if (sorted.length >= 2) {
      const testMs = sorted[sorted.length - 2]
      const latestMs = sorted[sorted.length - 1]
      return {
        kind: 'ok',
        value: testMs,
        displayValue: String(testMs),
        usedFallback: false,
        latestExcluded: String(latestMs),
        valueKind: 'timestamp',
      }
    }
    const only = sorted[0]
    const fallbackMs = only - HOUR_MS
    return {
      kind: 'ok',
      value: fallbackMs,
      displayValue: String(fallbackMs),
      usedFallback: true,
      valueKind: 'timestamp',
    }
  }

  const numericValues = classified
    .map((row) => parseNumericValue(row.value))
    .filter((n): n is number => n != null)
  if (numericValues.length) {
    const sorted = uniqueSortedNumbers(numericValues)
    if (sorted.length >= 2) {
      const testVal = sorted[sorted.length - 2]
      const latestVal = sorted[sorted.length - 1]
      return {
        kind: 'ok',
        value: testVal,
        displayValue: String(testVal),
        usedFallback: false,
        latestExcluded: String(latestVal),
        valueKind: 'numeric',
      }
    }
    const only = sorted[0]
    return {
      kind: 'ok',
      value: only - 1,
      displayValue: String(only - 1),
      usedFallback: true,
      valueKind: 'numeric',
    }
  }

  if (kinds.has('string')) {
    return {
      kind: 'unsortable_string',
      reason: 'Cannot calculate a safe test checkpoint from this field.',
    }
  }

  return { kind: 'disabled', reason: 'Select a checkpoint field with values first.' }
}

/** Build API-test checkpoint dict for shared request builder substitution. */
export function buildApiTestCheckpointPayload(
  test: Extract<IncrementalRequestTestCheckpointResult, { kind: 'ok' }>,
): Record<string, unknown> {
  if (test.valueKind === 'timestamp') {
    const ms = typeof test.value === 'number' ? test.value : Number(test.value)
    return {
      last_timestamp: String(test.value),
      last_timestamp_ms: String(ms),
    }
  }
  return {
    last_event_id: String(test.value),
    last_timestamp: String(test.value),
    last_timestamp_ms: String(test.value),
  }
}

export function buildIncrementalRequestTestSignature(input: {
  pattern: IncrementalRequestPattern
  draft: string
  checkpointSourcePath: string
  eventArrayPath: string
}): string {
  return [
    input.pattern,
    input.draft.trim(),
    input.checkpointSourcePath.trim(),
    input.eventArrayPath.trim(),
  ].join('\u001f')
}

export type IncrementalRequestTestWarning =
  | { level: 'none' }
  | { level: 'warning'; message: string }

/** Review/create warnings when incremental template requires verification. */
export function incrementalRequestTestWarning(input: {
  pattern: IncrementalRequestPattern
  draft: string
  checkpointSourcePath: string
  eventArrayPath: string
  lastSuccessSignature: string | null
  lastSuccessAt: number | null
}): IncrementalRequestTestWarning {
  if (input.pattern === 'none' || !input.draft.trim()) {
    return { level: 'none' }
  }
  const signature = buildIncrementalRequestTestSignature({
    pattern: input.pattern,
    draft: input.draft,
    checkpointSourcePath: input.checkpointSourcePath,
    eventArrayPath: input.eventArrayPath,
  })
  if (!input.lastSuccessSignature || !input.lastSuccessAt) {
    return {
      level: 'warning',
      message: 'Incremental request has not been tested. Verify the request body works before creating the stream.',
    }
  }
  if (input.lastSuccessSignature !== signature) {
    return {
      level: 'warning',
      message: 'Incremental request changed after the last successful test. Re-run Test on JSON Preview before creating the stream.',
    }
  }
  return { level: 'none' }
}

/** Best-effort runtime JS type label for the sample value (used in the Selected checkpoint field card). */
export function sampleValueTypeLabel(value: unknown): string {
  if (value === null) return 'NULL'
  if (Array.isArray(value)) return 'ARRAY'
  switch (typeof value) {
    case 'number':
      return Number.isInteger(value) ? 'INTEGER' : 'NUMBER'
    case 'string':
      return 'STRING'
    case 'boolean':
      return 'BOOLEAN'
    case 'object':
      return 'OBJECT'
    case 'undefined':
      return '—'
    default:
      return String(typeof value).toUpperCase()
  }
}
