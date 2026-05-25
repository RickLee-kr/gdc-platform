/**
 * Event extraction path helpers for Stream Wizard record selection.
 * Persisted paths must never include preview-only indices ([0]) on the array path.
 */

/** Strip preview indices from array path before persistence. */
export function normalizeEventArrayPath(path: string): string {
  let p = path.trim()
  if (!p) return ''
  if (!p.startsWith('$')) p = `$${p.startsWith('.') ? p : `.${p}`}`
  while (/\[\d+\]$/.test(p) || /\[\*\]$/.test(p)) {
    p = p.replace(/\[\d+\]$/, '').replace(/\[\*\]$/, '')
  }
  return p
}

/** Normalize event_root_path for persistence (relative to each array item). */
export function normalizeEventRootPath(path: string): string {
  const p = path.trim()
  if (!p || p === '$') return ''
  return p.startsWith('$') ? p : `$.${p}`
}

/** Runtime extraction expression for operator summary (not persisted). */
export function formatRuntimeExtractionPath(eventArrayPath: string, eventRootPath: string): string {
  const arr = normalizeEventArrayPath(eventArrayPath)
  const arrWildcard = !arr || arr === '$' ? '$[*]' : `${arr}[*]`
  const root = normalizeEventRootPath(eventRootPath)
  if (!root) return arrWildcard
  const rootSuffix = root.startsWith('$') ? root.slice(1) : `.${root}`
  return `${arrWildcard}${rootSuffix}`
}

/** Preview-only path for one sample record (UI/debug). */
export function formatPreviewSamplePath(eventArrayPath: string, sampleIndex: number): string {
  const arr = normalizeEventArrayPath(eventArrayPath)
  const idx = Math.max(0, sampleIndex)
  if (!arr || arr === '$') return `$[${idx}]`
  return `${arr}[${idx}]`
}


/**
 * Convert an absolute JSONPath from the raw tree into a checkpoint field path
 * relative to each array record (never includes sample index on the array path).
 */
/**
 * Convert a raw-tree JSONPath click into checkpoint path relative to each array record.
 *
 * @example $[0].creationTime + array $ → $.creationTime
 * @example $.Records[0].event.eventTime + array $.Records → $.event.eventTime
 */
export function checkpointPathFromClick(
  clickedPath: string,
  eventArrayPath: string,
  previewSampleIndex = 0,
): string {
  const full = clickedPath.trim()
  if (!full) return ''

  const sampleRecord = formatPreviewSamplePath(eventArrayPath, previewSampleIndex)
  const arrayNorm = normalizeEventArrayPath(eventArrayPath) || '$'

  const stripPrefixes: string[] = [sampleRecord]
  if (arrayNorm !== sampleRecord) {
    stripPrefixes.push(`${arrayNorm}[0]`, arrayNorm, `${arrayNorm}[*]`)
  }
  if (arrayNorm === '$') {
    stripPrefixes.push('$[0]', '$')
  }

  for (const prefix of stripPrefixes) {
    if (!prefix) continue
    if (full === prefix) return ''
    if (full.startsWith(`${prefix}.`)) {
      const rel = full.slice(prefix.length + 1)
      return rel.startsWith('$') ? rel : `$.${rel}`
    }
  }

  if (full.startsWith('$.')) return full
  if (full.startsWith('$')) {
    const tail = full.slice(1).replace(/^\./, '')
    return tail ? `$.${tail}` : ''
  }
  return `$.${full.replace(/^\./, '')}`
}

export function toCheckpointRelativePath(
  clickedPath: string,
  eventArrayPath: string,
  _eventRootPath: string,
  previewSampleIndex = 0,
): string {
  return checkpointPathFromClick(clickedPath, eventArrayPath, previewSampleIndex)
}

/**
 * Convert a raw-tree JSONPath click into persisted event_root_path (relative to each array item).
 */
export function eventRootPathFromClick(clickedPath: string, eventArrayPath: string): string {
  const full = clickedPath.trim()
  if (!full) return ''

  const arrayNorm = normalizeEventArrayPath(eventArrayPath) || '$'

  if (arrayNorm === '$') {
    const match = full.match(/^\$(?:\[\d+\])?(?:\.(.+))?$/)
    if (!match?.[1]) return ''
    return `$.${match[1]}`
  }

  const prefixes = [`${arrayNorm}[0]`, arrayNorm, `${arrayNorm}[*]`]
  for (const prefix of prefixes) {
    if (full === prefix) return ''
    if (full.startsWith(`${prefix}.`)) {
      const rest = full.slice(prefix.length + 1)
      return rest.startsWith('$') ? rest : `$.${rest}`
    }
    if (full.startsWith(`${prefix}[`)) {
      const rest = full.slice(prefix.length).replace(/^\[\d+\]\.?/, '')
      if (!rest) return ''
      return rest.startsWith('$') ? rest : `$.${rest}`
    }
  }

  if (full.startsWith('$.')) return full
  return normalizeEventRootPath(full)
}

/** Absolute JSONPath in raw payload for highlighting a record-relative field. */
export function absolutePathInSampleRecord(
  eventArrayPath: string,
  recordRelativePath: string,
  sampleIndex: number,
): string {
  const rel = recordRelativePath.trim()
  if (!rel) return formatPreviewSamplePath(eventArrayPath, sampleIndex)
  const record = formatPreviewSamplePath(eventArrayPath, sampleIndex)
  const suffix = rel.startsWith('$') ? rel.slice(1) : rel.startsWith('.') ? rel : `.${rel}`
  return `${record}${suffix}`
}

export function formatCheckpointAppliesTo(eventArrayPath: string, checkpointRelativePath: string): string {
  const base = formatRuntimeExtractionPath(eventArrayPath, '')
  const cp = checkpointRelativePath.trim()
  if (!cp) return base
  const suffix = cp.startsWith('$') ? cp.slice(1) : `.${cp}`
  return `${base}${suffix}`
}

/** Reject persisted array paths that still contain a literal index. */
export function isPreviewOnlyArrayPath(path: string): boolean {
  const norm = normalizeEventArrayPath(path)
  return path.trim() !== norm && /\[\d+\]/.test(path.trim())
}

export function approxJsonBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size
  } catch {
    try {
      return JSON.stringify(value).length
    } catch {
      return 0
    }
  }
}
