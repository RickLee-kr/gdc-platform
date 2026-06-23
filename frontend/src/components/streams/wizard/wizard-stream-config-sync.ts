import { normalizeEventArrayPath } from '../../../utils/eventExtractionPaths'
import { normalizeCheckpointRelativePath } from '../../../utils/recordSelectionPaths'
import { normalizePaginationLabel } from '../stream-edit-request-params'
import { resolveCheckpointPathForRecord } from './wizard-incremental-request'
import type { WizardCheckpointFieldType, WizardConfigState } from './wizard-state'

function normalizedArrayPath(eventArrayPath: string): string {
  const trimmed = eventArrayPath.trim()
  if (!trimmed) return ''
  return normalizeEventArrayPath(trimmed.startsWith('$') ? trimmed : `$.${trimmed}`)
}

export type AdvancedStreamConfigPatch = Pick<
  WizardConfigState,
  | 'checkpointMode'
  | 'checkpointSecondaryPath'
  | 'schemaRootPath'
  | 'initialDelaySec'
  | 'paginationType'
  | 'paginationCursorParam'
  | 'paginationPageSize'
  | 'paginationMaxPages'
  | 'checkpointSourcePath'
  | 'checkpointFieldType'
  | 'eventArrayPath'
  | 'eventRootPath'
  | 'useWholeResponseAsEvent'
>

function parseInitialDelaySec(cfg: Record<string, unknown>): number {
  const raw = cfg.initial_delay_sec ?? cfg.initialDelaySec
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw)
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  return 0
}

function inferPaginationFromConfig(cfg: Record<string, unknown>): {
  paginationType: string
  paginationCursorParam: string
  paginationPageSize: number
  paginationMaxPages: number
} {
  const pag = (cfg.pagination ?? {}) as Record<string, unknown>
  const rawType = typeof pag.type === 'string' ? pag.type.trim() : ''
  const paginationType = rawType ? normalizePaginationLabel(rawType) : 'None'

  let paginationPageSize = 0
  const ps = pag.page_size
  if (typeof ps === 'number' && Number.isFinite(ps) && ps > 0) paginationPageSize = ps
  else if (typeof ps === 'string' && ps.trim()) {
    const parsed = Number(ps)
    if (Number.isFinite(parsed) && parsed > 0) paginationPageSize = parsed
  }

  let paginationMaxPages = 0
  const mp = pag.max_pages
  if (typeof mp === 'number' && Number.isFinite(mp)) paginationMaxPages = Math.max(0, mp)
  else if (typeof mp === 'string' && mp.trim()) {
    const parsed = Number(mp)
    if (Number.isFinite(parsed)) paginationMaxPages = Math.max(0, parsed)
  }

  let paginationCursorParam = typeof pag.cursor_param === 'string' ? pag.cursor_param.trim() : ''
  const prm = (cfg.params ?? {}) as Record<string, unknown>
  if (paginationType !== 'None' && prm && typeof prm === 'object' && !paginationCursorParam) {
    for (const k of Object.keys(prm)) {
      if (k === 'limit') continue
      if (prm[k] != null && typeof prm[k] !== 'object') {
        paginationCursorParam = k
        break
      }
    }
  }

  return { paginationType, paginationCursorParam, paginationPageSize, paginationMaxPages }
}

export function checkpointFieldTypeFromMode(mode: string): WizardCheckpointFieldType {
  const normalized = mode.trim().toLowerCase()
  if (normalized.includes('timestamp')) return 'TIMESTAMP'
  if (normalized.includes('event id')) return 'EVENT_ID'
  if (normalized.includes('cursor')) return 'CURSOR'
  if (normalized.includes('offset')) return 'OFFSET'
  return 'CURSOR'
}

export function checkpointModeFromFieldType(fieldType: WizardCheckpointFieldType): string {
  const upper = fieldType.toUpperCase()
  if (upper === 'TIMESTAMP' || upper === 'DATETIME') return 'Timestamp'
  if (upper === 'EVENT_ID') return 'Event ID'
  if (upper === 'CURSOR') return 'Cursor'
  return 'Cursor'
}

/** Convert persisted cursor path to wizard-relative checkpoint path. */
export function checkpointSourcePathFromPersistedCursor(
  cursorPath: string,
  eventArrayPath: string,
): string {
  const trimmed = cursorPath.trim()
  if (!trimmed) return ''
  const arrayNorm = normalizedArrayPath(eventArrayPath)
  if (arrayNorm) {
    const wildcard = arrayNorm === '$' ? '$[*]' : `${arrayNorm}[*]`
    if (trimmed === wildcard) return '$'
    if (trimmed.startsWith(`${wildcard}.`)) {
      return normalizeCheckpointRelativePath(trimmed.slice(wildcard.length + 1))
    }
    const sample = arrayNorm === '$' ? '$[0]' : `${arrayNorm}[0]`
    if (trimmed.startsWith(`${sample}.`)) {
      return normalizeCheckpointRelativePath(trimmed.slice(sample.length + 1))
    }
  }
  const resolved = resolveCheckpointPathForRecord(trimmed, eventArrayPath)
  if (resolved.trim() && resolved !== trimmed) return normalizeCheckpointRelativePath(resolved)
  return normalizeCheckpointRelativePath(trimmed)
}

/** Convert wizard-relative checkpoint path to persisted cursor path. */
export function persistedCursorPathFromCheckpoint(
  checkpointSourcePath: string,
  eventArrayPath: string,
): string {
  const rel = normalizeCheckpointRelativePath(checkpointSourcePath)
  if (!rel) return ''
  const arrayNorm = normalizedArrayPath(eventArrayPath)
  if (!arrayNorm) return rel
  if (rel === '$') return arrayNorm === '$' ? '$[*]' : `${arrayNorm}[*]`
  const suffix = rel.startsWith('$.') ? rel.slice(1) : `.${rel.replace(/^\$\.?/, '')}`
  const wildcard = arrayNorm === '$' ? '$[*]' : `${arrayNorm}[*]`
  return `${wildcard}${suffix}`
}

export function readAdvancedStreamConfigFromPersisted(
  cfg: Record<string, unknown>,
  mapping: { event_array_path?: string | null; event_root_path?: string | null } | null | undefined,
): Partial<AdvancedStreamConfigPatch> {
  const schema = (cfg.schema ?? {}) as Record<string, unknown>
  const ck = (cfg.checkpoint ?? {}) as Record<string, unknown>

  const mappingEventArray = stripJsonPathPrefix(mapping?.event_array_path)
  const mappingEventRoot = stripJsonPathPrefix(mapping?.event_root_path)
  const cfgEventArray = stripJsonPathPrefix(
    typeof cfg.event_array_path === 'string' ? cfg.event_array_path : null,
  )
  const cfgEventRoot = stripJsonPathPrefix(typeof cfg.event_root_path === 'string' ? cfg.event_root_path : null)

  const eventArrayPath = mappingEventArray || cfgEventArray
  const eventRootPath = mappingEventRoot || cfgEventRoot
  const useWholeResponseAsEvent = !mapping?.event_array_path && !cfgEventArray && !eventArrayPath

  const primaryCursor =
    typeof ck.cursor_path === 'string' && ck.cursor_path.trim()
      ? ck.cursor_path.trim()
      : Array.isArray(ck.cursor_paths) && typeof ck.cursor_paths[0] === 'string'
        ? ck.cursor_paths[0].trim()
        : ''

  const secondaryCursor =
    typeof ck.secondary_cursor_path === 'string' && ck.secondary_cursor_path.trim()
      ? ck.secondary_cursor_path.trim()
      : Array.isArray(ck.cursor_paths) && typeof ck.cursor_paths[1] === 'string'
        ? ck.cursor_paths[1].trim()
        : ''

  const checkpointMode =
    typeof ck.mode === 'string' && ck.mode.trim() ? ck.mode.trim() : 'Cursor'
  const checkpointSourcePath = checkpointSourcePathFromPersistedCursor(primaryCursor, eventArrayPath)
  const checkpointSecondaryPath = checkpointSourcePathFromPersistedCursor(secondaryCursor, eventArrayPath)
  const checkpointFieldType = checkpointSourcePath
    ? checkpointFieldTypeFromMode(checkpointMode)
    : ('' as WizardCheckpointFieldType)

  return {
    eventArrayPath,
    eventRootPath,
    useWholeResponseAsEvent,
    checkpointMode,
    checkpointSourcePath,
    checkpointSecondaryPath,
    checkpointFieldType,
    schemaRootPath: typeof schema.root_path === 'string' ? schema.root_path.trim() : '',
    initialDelaySec: parseInitialDelaySec(cfg),
    ...inferPaginationFromConfig(cfg),
  }
}

function stripJsonPathPrefix(path: string | null | undefined): string {
  const trimmed = String(path ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
}

export function buildAdvancedStreamConfigJsonPatch(
  stream: Pick<
    WizardConfigState,
    | 'checkpointMode'
    | 'checkpointSecondaryPath'
    | 'checkpointSourcePath'
    | 'checkpointFieldType'
    | 'eventArrayPath'
    | 'schemaRootPath'
    | 'initialDelaySec'
    | 'paginationType'
    | 'paginationCursorParam'
    | 'paginationPageSize'
    | 'paginationMaxPages'
  >,
): Record<string, unknown> {
  const primary = persistedCursorPathFromCheckpoint(stream.checkpointSourcePath, stream.eventArrayPath)
  const secondary = persistedCursorPathFromCheckpoint(
    stream.checkpointSecondaryPath,
    stream.eventArrayPath,
  )
  const mode =
    stream.checkpointMode.trim() ||
    (stream.checkpointSourcePath.trim() ? checkpointModeFromFieldType(stream.checkpointFieldType) : 'Cursor')

  const patch: Record<string, unknown> = {
    initial_delay_sec: Math.max(0, Math.floor(stream.initialDelaySec || 0)),
    pagination: {
      type: normalizePaginationLabel(stream.paginationType) === 'None' ? 'none' : stream.paginationType,
      cursor_param: stream.paginationCursorParam.trim(),
      page_size: stream.paginationPageSize > 0 ? stream.paginationPageSize : undefined,
      max_pages: stream.paginationMaxPages > 0 ? stream.paginationMaxPages : undefined,
    },
    schema: {
      root_path: stream.schemaRootPath.trim() || undefined,
    },
  }

  if (primary) {
    patch.checkpoint = {
      mode,
      cursor_path: primary,
      ...(secondary ? { secondary_cursor_path: secondary } : {}),
      cursor_paths: [primary, secondary].filter(Boolean),
      comparator: secondary ? 'lexicographical' : 'single_field',
    }
  }

  return patch
}

export function mergeStreamConfigJson(
  existing: Record<string, unknown> | null | undefined,
  streamPayload: Record<string, unknown>,
  advancedPatch: Record<string, unknown>,
): Record<string, unknown> {
  const base = { ...(existing ?? {}), ...streamPayload }
  const existingCheckpoint = (base.checkpoint ?? {}) as Record<string, unknown>
  const existingSchema = (base.schema ?? {}) as Record<string, unknown>
  const existingPagination = (base.pagination ?? {}) as Record<string, unknown>
  const nextCheckpoint = advancedPatch.checkpoint
  const nextSchema = advancedPatch.schema
  const nextPagination = advancedPatch.pagination

  return {
    ...base,
    initial_delay_sec: advancedPatch.initial_delay_sec ?? base.initial_delay_sec,
    checkpoint:
      nextCheckpoint && typeof nextCheckpoint === 'object'
        ? { ...existingCheckpoint, ...nextCheckpoint }
        : existingCheckpoint,
    schema:
      nextSchema && typeof nextSchema === 'object' ? { ...existingSchema, ...nextSchema } : existingSchema,
    pagination:
      nextPagination && typeof nextPagination === 'object'
        ? { ...existingPagination, ...nextPagination }
        : existingPagination,
  }
}

export function formatMappingPathForDisplay(path: string, useWholeResponseAsEvent: boolean): string {
  if (useWholeResponseAsEvent) return '(entire response)'
  const trimmed = path.trim()
  if (!trimmed) return '—'
  return trimmed.startsWith('$') ? trimmed : `$.${trimmed}`
}

export function formatPersistedCursorPathForDisplay(
  checkpointSourcePath: string,
  eventArrayPath: string,
): string {
  const persisted = persistedCursorPathFromCheckpoint(checkpointSourcePath, eventArrayPath)
  return persisted.trim() || '—'
}
