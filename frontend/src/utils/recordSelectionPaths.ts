/**
 * Record Selection path model — single source of truth for wizard preview step.
 */
import {
  absolutePathInSampleRecord,
  checkpointPathFromClick,
  eventRootPathFromClick,
  formatCheckpointAppliesTo,
  formatPreviewSamplePath,
  formatRuntimeExtractionPath,
  normalizeEventArrayPath,
  normalizeEventRootPath,
} from './eventExtractionPaths'

export type RecordSelectionPaths = {
  eventArrayPath: string
  eventRootPath: string
  checkpointSourcePath: string
}

export {
  absolutePathInSampleRecord,
  checkpointPathFromClick,
  eventRootPathFromClick,
  formatCheckpointAppliesTo,
}

export function isRootLevelObjectArray(raw: unknown): boolean {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
  )
}

/** Effective persisted event array path for extraction and summary. */
export function effectiveEventArrayPath(
  eventArrayPath: string,
  useWholeResponseAsEvent: boolean,
  raw: unknown,
): string {
  const trimmed = eventArrayPath.trim()
  if (trimmed) return normalizeEventArrayPath(trimmed)
  if (isRootLevelObjectArray(raw)) return '$'
  if (useWholeResponseAsEvent) return ''
  return ''
}

export function deriveRecordSelectionPaths(
  eventArrayPath: string,
  eventRootPath: string,
  checkpointSourcePath: string,
  useWholeResponseAsEvent: boolean,
  raw: unknown,
): RecordSelectionPaths {
  const array = effectiveEventArrayPath(eventArrayPath, useWholeResponseAsEvent, raw)
  return {
    eventArrayPath: array,
    eventRootPath: normalizeEventRootPath(eventRootPath),
    checkpointSourcePath: normalizeCheckpointRelativePath(checkpointSourcePath),
  }
}

/** Normalize checkpoint path to $.field form (relative to each array record). */
export function normalizeCheckpointRelativePath(path: string): string {
  let p = path.trim()
  if (
    p.length >= 2 &&
    ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"')))
  ) {
    p = p.slice(1, -1).trim()
  }
  if (!p) return ''
  if (p.startsWith('$.')) return p
  if (p.startsWith('$')) return p.length > 1 ? `$.${p.slice(1).replace(/^\./, '')}` : ''
  return `$.${p.replace(/^\./, '')}`
}

export function eventArrayPathFromClick(clickedPath: string, raw: unknown): string {
  const normalized = normalizeEventArrayPath(clickedPath)
  if (normalized) return normalized
  if (isRootLevelObjectArray(raw)) return '$'
  return ''
}

export function recordSelectionSummary(paths: RecordSelectionPaths, recordCount: number, previewIndex: number) {
  return {
    eventSource: paths.eventArrayPath || '—',
    eventRoot: paths.eventRootPath || '(entire record)',
    runtimeExtraction: formatRuntimeExtractionPath(paths.eventArrayPath, paths.eventRootPath),
    recordsDetected: String(recordCount),
    previewSample: formatPreviewSamplePath(paths.eventArrayPath, previewIndex),
  }
}
