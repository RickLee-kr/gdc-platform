/**
 * Basic Incremental Fetch helpers: field recommendation + strategy auto-resolve.
 * Maps Basic UI choices onto existing config_json.incremental_fetch fields.
 */

import type { IncrementalFetchConfigValues, IncrementalFetchStrategy } from './incremental-fetch-config-model'

export const DEFAULT_STABILITY_LAG_SECONDS = 120
export const DEFAULT_INITIAL_LOOKBACK_SECONDS = 86_400

/** Priority-1 update/modified style names. */
const UPDATE_FIELD_NAMES = [
  'updated_at',
  'update_time',
  'updatedAt',
  'updateTime',
  'modified_at',
  'modifiedAt',
  'last_modified',
  'lastModified',
  'lastModifiedTime',
  'last_modified_time',
  'write_time',
  'writeTime',
] as const

/** Priority-2 create style names. */
const CREATE_FIELD_NAMES = [
  'created_at',
  'creationTime',
  'createdTime',
  'createdAt',
  'create_time',
  'createTime',
] as const

/** Priority-3 generic timestamp names. */
const GENERIC_TIMESTAMP_NAMES = [
  'timestamp',
  'event_time',
  'eventTime',
  'event_timestamp',
  'eventTimestamp',
  'time',
  'datetime',
  'date_time',
] as const

const CURSOR_FIELD_NAMES = [
  'cursor',
  'next_cursor',
  'nextCursor',
  'page_token',
  'pageToken',
  'next_page_token',
  'nextPageToken',
  'continuation_token',
  'continuationToken',
] as const

const ALL_TIMESTAMP_NAMES = new Set<string>(
  [...UPDATE_FIELD_NAMES, ...CREATE_FIELD_NAMES, ...GENERIC_TIMESTAMP_NAMES].map((n) => n.toLowerCase()),
)

export type IncrementalFieldCandidate = {
  path: string
  sampleValue?: unknown
}

export type IncrementalFieldRecommendation = {
  path: string
  leaf: string
  rank: number
  reason: string
}

function leafName(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  const noPrefix = trimmed.replace(/^\$\.?/, '')
  const parts = noPrefix.split('.').filter(Boolean)
  const last = parts[parts.length - 1] ?? noPrefix
  return last.replace(/\[\d+\]/g, '').replace(/\[\*\]/g, '')
}

export function normalizeIncrementalFieldPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('$')) return trimmed
  return `$.${trimmed.replace(/^\./, '')}`
}

export function isTimestampFieldName(nameOrPath: string): boolean {
  const leaf = leafName(nameOrPath).toLowerCase()
  if (!leaf) return false
  if (ALL_TIMESTAMP_NAMES.has(leaf)) return true
  return (
    leaf.endsWith('_at') ||
    leaf.endsWith('_time') ||
    leaf.includes('timestamp') ||
    leaf.includes('modified')
  )
}

export function isCursorFieldName(nameOrPath: string): boolean {
  const leaf = leafName(nameOrPath).toLowerCase()
  if (!leaf) return false
  for (const known of CURSOR_FIELD_NAMES) {
    if (known.toLowerCase() === leaf) return true
  }
  return leaf.includes('cursor') || leaf.includes('pagetoken') || leaf.includes('page_token')
}

function looksLikeUnixTimestamp(value: unknown): boolean {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // seconds or ms since ~2001–2100
    return (value > 1_000_000_000 && value < 4_102_444_800) || (value > 1_000_000_000_000 && value < 4_102_444_800_000)
  }
  if (typeof value === 'string' && /^\d{10,13}$/.test(value.trim())) {
    return looksLikeUnixTimestamp(Number(value.trim()))
  }
  return false
}

function looksLikeIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length < 8) return false
  // ISO8601 / RFC3339-ish
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return false
  const ms = Date.parse(text)
  return Number.isFinite(ms)
}

function rankKnownName(leaf: string): number | null {
  const lower = leaf.toLowerCase()
  for (const name of UPDATE_FIELD_NAMES) {
    if (name.toLowerCase() === lower) return 1
  }
  for (const name of CREATE_FIELD_NAMES) {
    if (name.toLowerCase() === lower) return 2
  }
  for (const name of GENERIC_TIMESTAMP_NAMES) {
    if (name.toLowerCase() === lower) return 3
  }
  return null
}

/**
 * Rank timestamp-like candidates from sample / union schema fields.
 * Lower rank = higher priority.
 */
export function recommendIncrementalFields(
  candidates: IncrementalFieldCandidate[],
): IncrementalFieldRecommendation[] {
  const seen = new Set<string>()
  const out: IncrementalFieldRecommendation[] = []

  for (const candidate of candidates) {
    const path = normalizeIncrementalFieldPath(candidate.path)
    if (!path || seen.has(path)) continue
    const leaf = leafName(path)
    if (!leaf) continue

    const knownRank = rankKnownName(leaf)
    let rank: number | null = knownRank
    let reason = ''

    if (knownRank === 1) reason = 'Update / modified timestamp field'
    else if (knownRank === 2) reason = 'Created-at timestamp field'
    else if (knownRank === 3) reason = 'Generic timestamp field'
    else if (looksLikeUnixTimestamp(candidate.sampleValue)) {
      rank = 4
      reason = 'Numeric timestamp-like value'
    } else if (looksLikeIsoTimestamp(candidate.sampleValue)) {
      rank = 5
      reason = 'ISO8601 / RFC3339 timestamp string'
    } else if (isTimestampFieldName(leaf)) {
      rank = 5
      reason = 'Timestamp-like field name'
    }

    if (rank == null) continue
    seen.add(path)
    out.push({ path, leaf, rank, reason })
  }

  out.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
  return out
}

export function pickDefaultIncrementalField(
  candidates: IncrementalFieldCandidate[],
): string {
  return recommendIncrementalFields(candidates)[0]?.path ?? ''
}

export type ResolveIncrementalStrategyInput = {
  incrementalField?: string | null
  cursorFieldConfigured?: string | null
  /** When false, prefer timestamp_watermark over closed_window_watermark. */
  allowClosedWindow?: boolean
  advancedOverride?: boolean
  manualStrategy?: IncrementalFetchStrategy | null
}

/**
 * Auto-select strategy from Basic field / cursor presence.
 * Advanced override keeps the manual strategy.
 */
export function resolveIncrementalFetchStrategy(
  input: ResolveIncrementalStrategyInput,
): IncrementalFetchStrategy {
  if (input.advancedOverride && input.manualStrategy) {
    return input.manualStrategy
  }

  const field = (input.incrementalField ?? '').trim()
  const cursorConfigured = (input.cursorFieldConfigured ?? '').trim()
  const allowClosedWindow = input.allowClosedWindow !== false

  if (field && isCursorFieldName(field)) {
    return 'cursor'
  }
  if (!field && cursorConfigured) {
    return 'cursor'
  }
  if (field && isTimestampFieldName(field)) {
    return allowClosedWindow ? 'closed_window_watermark' : 'timestamp_watermark'
  }
  if (field) {
    return 'custom'
  }
  return ''
}

/** Basic "Incremental field" shown to the user (watermark or cursor). */
export function basicIncrementalFieldFromValues(
  values: Pick<IncrementalFetchConfigValues, 'strategy' | 'watermarkField' | 'cursorField'>,
): string {
  if (values.strategy === 'cursor') {
    return values.cursorField.trim() || values.watermarkField.trim()
  }
  return values.watermarkField.trim() || values.cursorField.trim()
}

/**
 * Apply a Basic incremental-field selection onto config values.
 * Resets advancedOverride and fills strategy / watermark / lag defaults.
 */
export function applyBasicIncrementalField(
  field: string,
  current: IncrementalFetchConfigValues,
  opts?: { allowClosedWindow?: boolean; hasCursorInConfig?: boolean },
): IncrementalFetchConfigValues {
  const normalized = normalizeIncrementalFieldPath(field)
  const strategy = resolveIncrementalFetchStrategy({
    incrementalField: normalized,
    cursorFieldConfigured: opts?.hasCursorInConfig ? current.cursorField : '',
    allowClosedWindow: opts?.allowClosedWindow,
    advancedOverride: false,
  })

  if (!normalized) {
    return {
      ...current,
      strategy: '',
      watermarkField: '',
      advancedOverride: false,
    }
  }

  if (strategy === 'cursor') {
    return {
      ...current,
      strategy: 'cursor',
      cursorField: normalized,
      watermarkField: '',
      advancedOverride: false,
    }
  }

  if (strategy === 'closed_window_watermark') {
    return {
      ...current,
      strategy: 'closed_window_watermark',
      watermarkField: normalized,
      stabilityLagSeconds:
        current.stabilityLagSeconds > 0 ? current.stabilityLagSeconds : DEFAULT_STABILITY_LAG_SECONDS,
      advancedOverride: false,
    }
  }

  if (strategy === 'timestamp_watermark') {
    return {
      ...current,
      strategy: 'timestamp_watermark',
      watermarkField: normalized,
      advancedOverride: false,
    }
  }

  return {
    ...current,
    strategy: 'custom',
    watermarkField: normalized,
    advancedOverride: false,
  }
}

/** Detect whether persisted strategy differs from auto-resolve (Advanced override). */
export function detectAdvancedOverride(
  values: Pick<IncrementalFetchConfigValues, 'strategy' | 'watermarkField' | 'cursorField'>,
): boolean {
  if (!values.strategy) return false
  const basicField = basicIncrementalFieldFromValues(values)
  const auto = resolveIncrementalFetchStrategy({
    incrementalField: basicField,
    cursorFieldConfigured: values.cursorField,
    advancedOverride: false,
  })
  return auto !== values.strategy
}

export function syncSafetyLabel(strategy: IncrementalFetchStrategy, stabilityLagSeconds: number): string {
  if (strategy === 'closed_window_watermark') {
    const lag = stabilityLagSeconds > 0 ? stabilityLagSeconds : DEFAULT_STABILITY_LAG_SECONDS
    return `Safe default: wait ${lag} seconds before fetching newest records.`
  }
  if (strategy === 'timestamp_watermark') {
    return 'Timestamp watermark (no closed-window lag).'
  }
  if (strategy === 'cursor') {
    return 'Cursor-based incremental sync.'
  }
  if (strategy === 'custom') {
    return 'Custom incremental strategy.'
  }
  return 'Not configured'
}

/** Selectable Incremental field option for the searchable dropdown. */
export type IncrementalFieldOption = {
  path: string
  label: string
  recommended: boolean
  reason?: string
}

const CONTAINER_FIELD_TYPES = new Set(['object', 'array'])

export type BuildIncrementalFieldCandidatesInput = {
  /** Prefer Union Schema as source of truth when present. */
  unionSchemaFields?: Array<{ field_path: string; field_type?: string; sample_values?: unknown[] }> | null
  /** Fallback / merge source from extracted sample preview fields. */
  sampleFields?: IncrementalFieldCandidate[] | null
  /** Always keep the currently selected path even if missing from sources. */
  selectedPath?: string | null
}

/**
 * Build the full Incremental field candidate list from Union Schema and/or Sample Fields.
 * Object/array containers are excluded (leaf fields only), except a currently selected path.
 */
export function buildIncrementalFieldCandidates(
  input: BuildIncrementalFieldCandidatesInput,
): IncrementalFieldCandidate[] {
  const byPath = new Map<string, IncrementalFieldCandidate>()
  const selected = normalizeIncrementalFieldPath(input.selectedPath ?? '')

  const unionFields = input.unionSchemaFields ?? []
  for (const field of unionFields) {
    const path = normalizeIncrementalFieldPath(field.field_path)
    if (!path || path === '$') continue
    const fieldType = (field.field_type ?? '').toLowerCase()
    if (CONTAINER_FIELD_TYPES.has(fieldType) && path !== selected) continue
    const sampleValue = Array.isArray(field.sample_values) ? field.sample_values[0] : undefined
    const existing = byPath.get(path)
    byPath.set(path, {
      path,
      sampleValue: sampleValue !== undefined ? sampleValue : existing?.sampleValue,
    })
  }

  for (const sample of input.sampleFields ?? []) {
    const path = normalizeIncrementalFieldPath(sample.path)
    if (!path || path === '$') continue
    const existing = byPath.get(path)
    if (existing) {
      if (existing.sampleValue === undefined && sample.sampleValue !== undefined) {
        byPath.set(path, { path, sampleValue: sample.sampleValue })
      }
      continue
    }
    // Sample flatten may include containers — skip non-primitive sample values unless selected.
    if (
      path !== selected &&
      sample.sampleValue !== null &&
      typeof sample.sampleValue === 'object'
    ) {
      continue
    }
    byPath.set(path, { path, sampleValue: sample.sampleValue })
  }

  if (selected && !byPath.has(selected)) {
    byPath.set(selected, { path: selected })
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Dropdown options: recommended fields first (with reason), then remaining full-field list.
 */
export function buildIncrementalFieldOptions(
  candidates: IncrementalFieldCandidate[],
  selectedPath?: string | null,
): IncrementalFieldOption[] {
  const selected = normalizeIncrementalFieldPath(selectedPath ?? '')
  const recommendations = recommendIncrementalFields(candidates)
  const reasonByPath = new Map(recommendations.map((r) => [r.path, r.reason] as const))
  const recommendedPaths = new Set(recommendations.map((r) => r.path))

  const options: IncrementalFieldOption[] = []
  const seen = new Set<string>()

  for (const rec of recommendations) {
    seen.add(rec.path)
    options.push({
      path: rec.path,
      label: `${rec.path} — ${rec.reason}`,
      recommended: true,
      reason: rec.reason,
    })
  }

  const rest = candidates
    .map((c) => normalizeIncrementalFieldPath(c.path))
    .filter((path) => path && !seen.has(path))
    .sort((a, b) => a.localeCompare(b))

  for (const path of rest) {
    seen.add(path)
    const reason = reasonByPath.get(path)
    options.push({
      path,
      label: reason ? `${path} — ${reason}` : path,
      recommended: recommendedPaths.has(path),
      reason,
    })
  }

  if (selected && !seen.has(selected)) {
    options.unshift({
      path: selected,
      label: selected,
      recommended: false,
    })
  }

  return options
}

export function filterIncrementalFieldOptions(
  options: IncrementalFieldOption[],
  query: string,
): IncrementalFieldOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter(
    (opt) =>
      opt.path.toLowerCase().includes(q) ||
      opt.label.toLowerCase().includes(q) ||
      (opt.reason ?? '').toLowerCase().includes(q),
  )
}
