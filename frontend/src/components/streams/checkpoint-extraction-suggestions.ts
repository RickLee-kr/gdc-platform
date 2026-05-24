/**
 * UI-only checkpoint extraction suggestions from API Test / JSON Preview samples.
 * Does not configure runtime or StreamRunner — guidance for form state only.
 */

import { checkpointPathFromClick, formatPreviewSamplePath, normalizeEventArrayPath } from '../../utils/eventExtractionPaths'
import { normalizeCheckpointRelativePath } from '../../utils/recordSelectionPaths'
import { wizardExtractEvents } from './wizard/wizard-json-extract'

export type CheckpointFieldType = 'TIMESTAMP' | 'EVENT_ID' | 'CURSOR' | 'OFFSET'

export type DetectedCheckpointCandidate = {
  path: string
  checkpointType: CheckpointFieldType
  confidence: number
  sampleValue: unknown
  reason: string
}

export type DetectedEventArrayCandidate = {
  path: string
  count: number
  confidence: number
  reason: string
}

export type CheckpointExtractionSuggestions = {
  suggestedCheckpointType: CheckpointFieldType | null
  suggestedCheckpointTypeLabel: string
  /** Relative to each event record (wizard checkpointSourcePath). */
  suggestedExtractionPathRelative: string | null
  /** Absolute-style path for display (last item in array). */
  suggestedExtractionPathAbsolute: string | null
  suggestedEventArrayPath: string | null
  suggestedSort: string | null
  suggestedTieBreaker: string | null
  warnings: string[]
  detectedCheckpointCandidates: DetectedCheckpointCandidate[]
  detectedEventArrayCandidates: DetectedEventArrayCandidate[]
  /** Short explainers shown in the panel. */
  notes: string[]
}

const TIMESTAMP_KEYS = new Set(
  [
    'timestamp',
    'time',
    'created_at',
    'updated_at',
    'creationtime',
    'eventtime',
    'ingested_at',
    'last_seen',
    'modified_at',
    'creationTime',
    'eventTime',
    'captured_at',
    'occurred_at',
  ].map((k) => k.toLowerCase()),
)

const CURSOR_KEYS = new Set(
  ['cursor', 'next_cursor', 'nextpagetoken', 'pagetoken', 'page_token', 'nextpagetoken', 'offset'].map((k) =>
    k.toLowerCase(),
  ),
)

const EVENT_ID_KEYS = new Set(
  ['id', 'event_id', 'uuid', 'alert_id', 'detection_id', 'eventid', 'record_id', 'guid'].map((k) => k.toLowerCase()),
)

const EVENTISH_SEGMENTS = new Set([
  'items',
  'events',
  'results',
  'records',
  'data',
  'malops',
  'rows',
  'values',
  'entities',
  'findings',
  'alerts',
  'logs',
  'elements',
  'members',
  'list',
  'content',
])

function segmentName(path: string): string {
  const clean = path.replace(/^\$\./, '')
  const parts = clean.split(/\.|\[/).filter(Boolean)
  return (parts[parts.length - 1] ?? '').replace(/\]$/, '').toLowerCase()
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function iso8601Like(s: string): boolean {
  return /\d{4}-\d{2}-\d{2}|\d{10,13}/.test(s)
}

function classifyField(key: string, value: unknown): { type: CheckpointFieldType; confidence: number; reason: string } | null {
  const lk = key.toLowerCase()
  if (
    TIMESTAMP_KEYS.has(lk) ||
    lk.includes('timestamp') ||
    lk.includes('created') ||
    lk.includes('updated') ||
    lk.includes('modified') ||
    (lk.includes('time') && !lk.includes('timeout'))
  ) {
    if (typeof value === 'number') return { type: 'TIMESTAMP', confidence: 0.82, reason: 'Likely timestamp field (numeric)' }
    if (typeof value === 'string' && iso8601Like(value)) {
      return { type: 'TIMESTAMP', confidence: 0.9, reason: 'Likely timestamp field (ISO-like string)' }
    }
    if (typeof value === 'string') return { type: 'TIMESTAMP', confidence: 0.58, reason: 'Time-like field name' }
  }
  if (EVENT_ID_KEYS.has(lk) || lk.endsWith('_id') || lk === 'id') {
    if (typeof value === 'string' || typeof value === 'number') {
      return {
        type: 'EVENT_ID',
        confidence: EVENT_ID_KEYS.has(lk) ? 0.88 : 0.72,
        reason: 'Likely event identifier field',
      }
    }
  }
  if (CURSOR_KEYS.has(lk) || lk.includes('cursor') || lk.endsWith('token')) {
    if (typeof value === 'string' || typeof value === 'number') {
      return { type: 'CURSOR', confidence: CURSOR_KEYS.has(lk) ? 0.9 : 0.65, reason: 'Likely cursor / pagination token' }
    }
  }
  if (lk === 'offset' || lk === 'page' || lk === 'skip') {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      return { type: 'OFFSET', confidence: 0.75, reason: 'Likely offset / page field' }
    }
  }
  return null
}

function scanScalars(obj: Record<string, unknown>, base: string, out: DetectedCheckpointCandidate[], depth = 0): void {
  if (depth > 3) return
  for (const [key, value] of Object.entries(obj)) {
    const path = base === '$' ? `$.${key}` : `${base}.${key}`
    if (isScalar(value)) {
      const hit = classifyField(key, value)
      if (hit) {
        out.push({
          path,
          checkpointType: hit.type,
          confidence: hit.confidence,
          sampleValue: value,
          reason: hit.reason,
        })
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      scanScalars(value as Record<string, unknown>, path, out, depth + 1)
    }
  }
}

function homogeneityScore(items: unknown[]): number {
  const dicts = items.slice(0, 5).filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
  if (dicts.length < 2) return 0
  const keySets = dicts.map((d) => new Set(Object.keys(d)))
  const inter = keySets.reduce((acc, s) => new Set([...acc].filter((k) => s.has(k))))
  const union = new Set(keySets.flatMap((s) => [...s]))
  return union.size ? inter.size / union.size : 0
}

function detectEventArrays(parsed: unknown, budget = { n: 400 }): DetectedEventArrayCandidate[] {
  const out: DetectedEventArrayCandidate[] = []

  function walk(value: unknown, path: string): void {
    if (budget.n <= 0) return
    budget.n -= 1
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      const seg = segmentName(path)
      let confidence = 0.52
      const reasons: string[] = []
      if (EVENTISH_SEGMENTS.has(seg)) {
        confidence += 0.22
        reasons.push(`segment "${seg}" often holds event lists`)
      }
      const hom = homogeneityScore(value)
      if (hom >= 0.5) {
        confidence += Math.min(0.2, hom * 0.25)
        reasons.push('array of objects with similar schema')
      }
      if (value.length >= 2) {
        confidence += 0.06
        reasons.push('multiple items detected')
      }
      out.push({
        path: normalizeEventArrayPath(path) || path,
        count: value.length,
        confidence: Math.min(0.99, confidence),
        reason: reasons.length ? reasons.join('; ') : 'Detected candidate array of objects',
      })
      for (let i = 0; i < Math.min(value.length, 8); i++) {
        const item = value[i]
        if (item && typeof item === 'object') walk(item, `${path}[${i}]`)
      }
      return
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const child = path === '$' ? `$.${k}` : `${path}.${k}`
        walk(v, child)
      }
    }
  }

  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
    walk(parsed, '$')
  } else if (parsed && typeof parsed === 'object') {
    walk(parsed, '$')
  }

  out.sort((a, b) => b.confidence - a.confidence || b.count - a.count)
  const seen = new Set<string>()
  return out.filter((c) => {
    if (seen.has(c.path)) return false
    seen.add(c.path)
    return true
  })
}

function pickBestCheckpoint(candidates: DetectedCheckpointCandidate[]): DetectedCheckpointCandidate | null {
  if (!candidates.length) return null
  const priority: CheckpointFieldType[] = ['TIMESTAMP', 'EVENT_ID', 'CURSOR', 'OFFSET']
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence)
  for (const kind of priority) {
    const hit = sorted.find((c) => c.checkpointType === kind)
    if (hit) return hit
  }
  return sorted[0] ?? null
}

function fieldNameFromPath(path: string): string {
  const m = path.match(/\.([^.[\]]+)$/)
  return m?.[1] ?? path.replace(/^\$\./, '')
}

function absoluteExtractionPath(eventArrayPath: string, relativePath: string, lastIndex = true): string {
  const arr = normalizeEventArrayPath(eventArrayPath) || '$'
  const rel = normalizeCheckpointRelativePath(relativePath)
  if (!rel) return ''
  const suffix = rel.startsWith('$') ? rel.slice(1) : `.${rel}`
  const index = lastIndex ? '[-1]' : '[*]'
  if (arr === '$') return `$${index}${suffix}`
  return `${arr}${index}${suffix}`
}

function findTieBreakerField(event: Record<string, unknown> | null): string | null {
  if (!event) return null
  for (const key of ['_id', 'id', 'event_id', 'uuid', 'alert_id', 'detection_id']) {
    if (key in event && isScalar(event[key])) return key
  }
  return null
}

function hasAscendingSortInPayload(parsed: unknown): boolean {
  try {
    const text = JSON.stringify(parsed).toLowerCase()
    return (text.includes('"sort"') || text.includes('"order"')) && text.includes('asc')
  } catch {
    return false
  }
}

export function analyzeCheckpointExtractionSuggestions(parsed: unknown): CheckpointExtractionSuggestions {
  const warnings: string[] = []
  const notes: string[] = [
    'Suggested values are detected candidates from this sample only — not automatic configuration.',
    'GDC only injects checkpoint variables where configured.',
    'GDC does not infer vendor-specific incremental query semantics.',
  ]

  if (parsed === null || parsed === undefined) {
    return {
      suggestedCheckpointType: null,
      suggestedCheckpointTypeLabel: '—',
      suggestedExtractionPathRelative: null,
      suggestedExtractionPathAbsolute: null,
      suggestedEventArrayPath: null,
      suggestedSort: null,
      suggestedTieBreaker: null,
      warnings: ['No JSON preview sample available yet. Run API Test successfully first.'],
      detectedCheckpointCandidates: [],
      detectedEventArrayCandidates: [],
      notes,
    }
  }

  const detectedEventArrayCandidates = detectEventArrays(parsed)
  const suggestedEventArrayPath = detectedEventArrayCandidates[0]?.path ?? null

  const rootCandidates: DetectedCheckpointCandidate[] = []
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    scanScalars(parsed as Record<string, unknown>, '$', rootCandidates)
  }

  const events = suggestedEventArrayPath
    ? wizardExtractEvents(parsed, suggestedEventArrayPath, '')
    : []
  const lastEvent = (events[events.length - 1] ?? events[0] ?? null) as Record<string, unknown> | null

  const eventCandidates: DetectedCheckpointCandidate[] = []
  if (lastEvent) scanScalars(lastEvent, '$', eventCandidates)

  const mergedCandidates = [...eventCandidates, ...rootCandidates]
    .sort((a, b) => b.confidence - a.confidence)
    .filter((c, i, arr) => arr.findIndex((x) => x.path === c.path && x.checkpointType === c.checkpointType) === i)

  const timestampCandidates = mergedCandidates.filter((c) => c.checkpointType === 'TIMESTAMP')
  if (timestampCandidates.length > 1) {
    warnings.push('Multiple timestamp fields detected. Verify which field is monotonic.')
  }

  const rootCursor = rootCandidates.filter((c) => c.checkpointType === 'CURSOR')
  const eventCursor = eventCandidates.filter((c) => c.checkpointType === 'CURSOR')
  if (rootCursor.length > 0 && eventCursor.length === 0) {
    warnings.push('Cursor field detected but no next cursor extraction path confirmed on event records.')
  }

  const eventBest = pickBestCheckpoint(eventCandidates)
  const rootBest = pickBestCheckpoint(rootCandidates)
  const best = eventBest ?? rootBest
  const suggestedCheckpointType = best?.checkpointType ?? null
  const suggestedCheckpointTypeLabel = suggestedCheckpointType ?? '—'

  let suggestedExtractionPathRelative: string | null = null
  let suggestedExtractionPathAbsolute: string | null = null

  if (best && suggestedEventArrayPath) {
    const absOnRecord = formatPreviewSamplePath(suggestedEventArrayPath, Math.max(0, events.length - 1))
    const rel = checkpointPathFromClick(`${absOnRecord}.${fieldNameFromPath(best.path)}`, suggestedEventArrayPath, Math.max(0, events.length - 1))
    suggestedExtractionPathRelative = rel || normalizeCheckpointRelativePath(best.path)
    suggestedExtractionPathAbsolute = absoluteExtractionPath(suggestedEventArrayPath, suggestedExtractionPathRelative)
  } else if (best) {
    suggestedExtractionPathRelative = normalizeCheckpointRelativePath(best.path)
    suggestedExtractionPathAbsolute = best.path
  }

  let suggestedSort: string | null = null
  let suggestedTieBreaker: string | null = null

  if (suggestedCheckpointType === 'TIMESTAMP' && best) {
    const field = fieldNameFromPath(best.path)
    suggestedSort = `${field} ASC`
    const tie = findTieBreakerField(lastEvent)
    if (tie && tie !== field) suggestedTieBreaker = `${tie} ASC`
    if (!hasAscendingSortInPayload(parsed)) {
      warnings.push('Timestamp incremental fetch usually requires ascending sort by the same field.')
    }
  } else if (suggestedCheckpointType === 'EVENT_ID' && best) {
    const field = fieldNameFromPath(best.path)
    suggestedSort = `${field} ASC`
    warnings.push('Event ID incremental fetch requires stable ascending ID order.')
  } else if (suggestedCheckpointType === 'CURSOR') {
    warnings.push('Cursor incremental fetch requires response next cursor extraction to update the checkpoint.')
  }

  if (!suggestedTieBreaker) {
    const tie = findTieBreakerField(lastEvent)
    if (tie) suggestedTieBreaker = `${tie} ASC`
  }

  if (suggestedEventArrayPath && events.length > 1 && !hasAscendingSortInPayload(parsed)) {
    warnings.push('Array order may not be stable unless the API supports explicit sorting.')
  }

  if (!best) {
    warnings.push('No stable sort field detected.')
  } else if (suggestedCheckpointType === 'TIMESTAMP' && !findTieBreakerField(lastEvent)) {
    warnings.push('No stable tie-breaker field (e.g. _id) detected on sample events.')
  }

  if (!suggestedEventArrayPath) {
    warnings.push('No likely event array path detected in this response sample.')
  }

  return {
    suggestedCheckpointType,
    suggestedCheckpointTypeLabel,
    suggestedExtractionPathRelative,
    suggestedExtractionPathAbsolute,
    suggestedEventArrayPath,
    suggestedSort,
    suggestedTieBreaker,
    warnings: [...new Set(warnings)],
    detectedCheckpointCandidates: mergedCandidates.slice(0, 16),
    detectedEventArrayCandidates,
    notes,
  }
}

export function mergeSortIntoRequestBody(requestBodyText: string, sortFieldName: string): string {
  const trimmed = requestBodyText.trim()
  const sortEntry = { fieldName: sortFieldName, order: 'ASC' }
  if (!trimmed) {
    return JSON.stringify({ sort: [sortEntry] }, null, 2)
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const existing = parsed.sort
    if (Array.isArray(existing)) {
      parsed.sort = [...existing, sortEntry]
    } else {
      parsed.sort = [sortEntry]
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return trimmed
  }
}
