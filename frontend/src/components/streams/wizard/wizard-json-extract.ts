import { eventRootPathFromClick, normalizeEventRootPath } from '../../../utils/eventExtractionPaths'
import { resolveJsonPath } from '../mapping-jsonpath'

/** Mirror onboarding extract rules: empty path → whole document as event(s). */
export function wizardExtractEvents(
  raw: unknown,
  eventArrayPath: string,
  eventRootPath = '',
): Array<Record<string, unknown>> {
  const path = eventArrayPath.trim()
  const root = eventRootPath.trim()
  const applyEventRoot = (event: Record<string, unknown>): Record<string, unknown> | null => {
    if (!root || root === '$') return event
    const normalizedRoot = root.startsWith('$') ? root : `$.${root}`
    const resolved = resolveJsonPath(event, normalizedRoot)
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return resolved as Record<string, unknown>
    }
    return null
  }
  if (!path || path === '$') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const picked = applyEventRoot(raw as Record<string, unknown>)
      return picked ? [picked] : []
    }
    if (Array.isArray(raw)) {
      return raw
        .filter(
          (x): x is Record<string, unknown> =>
            x !== null && typeof x === 'object' && !Array.isArray(x),
        )
        .map((x) => applyEventRoot(x))
        .filter((x): x is Record<string, unknown> => x !== null)
    }
    return []
  }
  const normalized = path.startsWith('$') ? path : `$.${path}`
  const resolved = resolveJsonPath(raw, normalized)
  if (resolved === undefined) return []
  if (Array.isArray(resolved)) {
    return resolved
      .filter(
        (x): x is Record<string, unknown> =>
          x !== null && typeof x === 'object' && !Array.isArray(x),
      )
      .map((x) => applyEventRoot(x))
      .filter((x): x is Record<string, unknown> => x !== null)
  }
  if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
    const picked = applyEventRoot(resolved as Record<string, unknown>)
    return picked ? [picked] : []
  }
  return []
}

/** @deprecated Use eventRootPathFromClick from eventExtractionPaths */
export function toEventRootRelativePath(path: string, eventArrayPath: string): string {
  return eventRootPathFromClick(path, eventArrayPath || '$')
}

/** Map an absolute raw-tree JSONPath to a mapping source path relative to the extracted event object. */
export function toExtractedEventRelativePath(
  path: string,
  eventArrayPath: string,
  eventRootPath: string,
): string {
  const fromItem = toEventRootRelativePath(path, eventArrayPath || '$')
  const root = normalizeEventRootPath(eventRootPath)
  if (!root) return fromItem
  const rootPrefix = root.startsWith('$') ? root : `$.${root}`
  if (fromItem === rootPrefix) return '$'
  if (fromItem.startsWith(`${rootPrefix}.`) || fromItem.startsWith(`${rootPrefix}[`)) {
    const suffix = fromItem.slice(rootPrefix.length)
    return suffix.startsWith('.') || suffix.startsWith('[') ? `$${suffix}` : fromItem
  }
  return fromItem
}

export function detectEventRootCandidates(firstEventItem: unknown): string[] {
  if (!firstEventItem || typeof firstEventItem !== 'object' || Array.isArray(firstEventItem)) return []
  const rec = firstEventItem as Record<string, unknown>
  const preferred = ['_source', 'payload', 'event', 'attributes', 'detail', 'data']
  const out: string[] = []
  for (const k of preferred) {
    const v = rec[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(`$.${k}`)
  }
  for (const [k, v] of Object.entries(rec)) {
    if (out.includes(`$.${k}`)) continue
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(`$.${k}`)
  }
  return out.slice(0, 12)
}

export function flattenSampleFields(obj: Record<string, unknown> | null, maxFields = 200, maxDepth = 8): string[] {
  if (!obj) return []
  const out: string[] = []

  function walk(v: unknown, p: string, depth: number) {
    if (out.length >= maxFields || depth > maxDepth) return
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      if (p && p !== '$') out.push(p)
      return
    }
    if (Array.isArray(v)) {
      if (p && p !== '$') out.push(p)
      return
    }
    if (typeof v === 'object') {
      if (p && p !== '$') out.push(p)
      const rec = v as Record<string, unknown>
      for (const k of Object.keys(rec)) {
        if (out.length >= maxFields) break
        const next = p === '$' ? `$.${k}` : `${p}.${k}`
        walk(rec[k], next, depth + 1)
      }
    }
  }

  walk(obj, '$', 0)
  return out
}
