/** UI-only incremental fetch compatibility analysis for stream request configuration. */

export type IncrementalFetchCompatibilityHint =
  | 'FULL_FETCH_RISK'
  | 'TIMESTAMP_INCREMENTAL_LIKELY'
  | 'CURSOR_INCREMENTAL_LIKELY'
  | 'EVENT_ID_INCREMENTAL_LIKELY'
  | 'CHECKPOINT_VARIABLE_MISSING'
  | 'SORT_REQUIRED'
  | 'DEPRECATED_CHECKPOINT_VARIABLE'

export const INCREMENTAL_FETCH_INJECTION_NOTE =
  'GDC only injects checkpoint variables where configured.'

export const INCREMENTAL_FETCH_NO_INFERENCE_NOTE =
  'GDC does not infer vendor-specific incremental query semantics.'

export const EXPLICIT_CHECKPOINT_VARIABLES = [
  '{{checkpoint.last_timestamp}}',
  '{{checkpoint.last_timestamp_ms}}',
  '{{checkpoint.last_event_id}}',
  '{{checkpoint.next_cursor}}',
] as const

export const EXPLICIT_RUNTIME_VARIABLES = ['{{runtime.now_ms}}', '{{runtime.now_iso}}'] as const

const TIMESTAMP_FIELD_NAMES = [
  'since',
  'from',
  'startTime',
  'start_time',
  'updated_after',
  'created_after',
  'creationTime',
  'timestamp',
] as const

const CURSOR_FIELD_NAMES = ['cursor', 'next_cursor', 'pageToken', 'page_token', 'nextPageToken'] as const

const EVENT_ID_FIELD_NAMES = ['id_gt', 'after_id', 'last_id', 'event_id'] as const

const DEPRECATED_CHECKPOINT_RE = /\{\{\s*checkpoint\s*\}\}(?!\.)/
const EXPLICIT_CHECKPOINT_FIELD_RE = /\{\{\s*checkpoint\.(last_timestamp_ms|last_timestamp|last_event_id|next_cursor)\s*\}\}/

const HINT_MESSAGES: Partial<Record<IncrementalFetchCompatibilityHint, string>> = {
  CHECKPOINT_VARIABLE_MISSING:
    'No checkpoint variable found. This stream may fetch the API default range or full dataset.',
  DEPRECATED_CHECKPOINT_VARIABLE:
    'Deprecated checkpoint variable found. Use explicit variables like {{checkpoint.last_timestamp}} or {{checkpoint.next_cursor}}.',
  SORT_REQUIRED: 'Timestamp incremental fetch usually requires ascending sort by the same field.',
  CURSOR_INCREMENTAL_LIKELY:
    'Cursor incremental fetch requires response next cursor extraction to update the checkpoint.',
  EVENT_ID_INCREMENTAL_LIKELY: 'Event ID incremental fetch requires stable ascending ID order.',
}

export type IncrementalFetchCompatibilityInput = {
  requestBodyText?: string
  queryParams?: Record<string, string>
  /** Platform-managed checkpoint (DB/runtime) — skip request-body checkpoint warnings. */
  platformCheckpointConfigured?: boolean
}

export type IncrementalFetchCompatibilityResult = {
  hints: IncrementalFetchCompatibilityHint[]
  messages: string[]
}

function normalizeText(input: IncrementalFetchCompatibilityInput): string {
  const body = (input.requestBodyText ?? '').trim()
  const params = input.queryParams ?? {}
  const paramText = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return [body, paramText].filter(Boolean).join('\n')
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function walkJson(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJson(item, visit)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      visit(key, value)
      walkJson(value, visit)
    }
  }
}

function jsonHasFieldName(node: unknown, names: readonly string[]): boolean {
  const set = new Set(names.map((n) => n.toLowerCase()))
  let found = false
  walkJson(node, (key, value) => {
    if (set.has(key.toLowerCase())) found = true
    if (typeof value === 'string' && names.some((n) => value.toLowerCase().includes(n.toLowerCase()))) {
      found = true
    }
  })
  return found
}

function textHasFieldName(text: string, names: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return names.some((name) => {
    const n = name.toLowerCase()
    return (
      lower.includes(`"${n}"`) ||
      lower.includes(`'${n}'`) ||
      lower.includes(`${n}=`) ||
      new RegExp(`\\b${n}\\b`, 'i').test(text)
    )
  })
}

export function hasDeprecatedCheckpointVariable(text: string): boolean {
  return DEPRECATED_CHECKPOINT_RE.test(text)
}

export function hasExplicitCheckpointVariable(text: string): boolean {
  return EXPLICIT_CHECKPOINT_FIELD_RE.test(text)
}

export function hasTimestampCheckpointVariable(text: string): boolean {
  return (
    text.includes('{{checkpoint.last_timestamp}}') || text.includes('{{checkpoint.last_timestamp_ms}}')
  )
}

export function hasCursorCheckpointVariable(text: string): boolean {
  return text.includes('{{checkpoint.next_cursor}}')
}

export function hasEventIdCheckpointVariable(text: string): boolean {
  return text.includes('{{checkpoint.last_event_id}}')
}

export function hasAscendingSortHint(bodyText: string, parsed: unknown | null): boolean {
  const lower = bodyText.toLowerCase()
  if (/"order"\s*:\s*"asc"/i.test(bodyText)) return true
  if (/"timestamp"\s*:\s*"asc"/i.test(bodyText)) return true
  if (/\bsort\b/.test(lower) && /\basc\b/.test(lower)) return true

  if (!parsed) return false

  let found = false
  walkJson(parsed, (key, value) => {
    if (key.toLowerCase() === 'sort') {
      const serialized = JSON.stringify(value).toLowerCase()
      if (serialized.includes('asc')) found = true
    }
    if (key.toLowerCase() === 'order' && String(value).toLowerCase() === 'asc') found = true
  })
  return found
}

function isConfigured(input: IncrementalFetchCompatibilityInput): boolean {
  const body = (input.requestBodyText ?? '').trim()
  const params = input.queryParams ?? {}
  return body.length > 0 || Object.keys(params).length > 0
}

export function analyzeIncrementalFetchCompatibility(
  input: IncrementalFetchCompatibilityInput,
): IncrementalFetchCompatibilityResult {
  const combined = normalizeText(input)
  const bodyText = (input.requestBodyText ?? '').trim()
  const parsed = tryParseJson(bodyText)
  const hints: IncrementalFetchCompatibilityHint[] = []
  const messages: string[] = []

  const pushHint = (hint: IncrementalFetchCompatibilityHint) => {
    if (!hints.includes(hint)) hints.push(hint)
    const message = HINT_MESSAGES[hint]
    if (message && !messages.includes(message)) messages.push(message)
  }

  if (hasDeprecatedCheckpointVariable(combined)) {
    pushHint('DEPRECATED_CHECKPOINT_VARIABLE')
  }

  const explicitCheckpoint = hasExplicitCheckpointVariable(combined)

  if (isConfigured(input) && !explicitCheckpoint && !input.platformCheckpointConfigured) {
    pushHint('CHECKPOINT_VARIABLE_MISSING')
    if (!hints.includes('FULL_FETCH_RISK')) hints.push('FULL_FETCH_RISK')
  }

  const timestampSignal =
    hasTimestampCheckpointVariable(combined) ||
    (parsed ? jsonHasFieldName(parsed, TIMESTAMP_FIELD_NAMES) : false) ||
    textHasFieldName(combined, TIMESTAMP_FIELD_NAMES)

  const cursorSignal =
    hasCursorCheckpointVariable(combined) ||
    (parsed ? jsonHasFieldName(parsed, CURSOR_FIELD_NAMES) : false) ||
    textHasFieldName(combined, CURSOR_FIELD_NAMES)

  const eventIdSignal =
    hasEventIdCheckpointVariable(combined) ||
    (parsed ? jsonHasFieldName(parsed, EVENT_ID_FIELD_NAMES) : false) ||
    textHasFieldName(combined, EVENT_ID_FIELD_NAMES)

  if (timestampSignal && (explicitCheckpoint || hasTimestampCheckpointVariable(combined))) {
    hints.push('TIMESTAMP_INCREMENTAL_LIKELY')
    if (!hasAscendingSortHint(bodyText, parsed)) {
      pushHint('SORT_REQUIRED')
    }
  }

  if (cursorSignal && (explicitCheckpoint || hasCursorCheckpointVariable(combined))) {
    hints.push('CURSOR_INCREMENTAL_LIKELY')
    pushHint('CURSOR_INCREMENTAL_LIKELY')
  }

  if (eventIdSignal && (explicitCheckpoint || hasEventIdCheckpointVariable(combined))) {
    hints.push('EVENT_ID_INCREMENTAL_LIKELY')
    pushHint('EVENT_ID_INCREMENTAL_LIKELY')
  }

  return { hints, messages }
}
