import {
  normalizeEventArrayPath,
  normalizeEventRootPath,
} from './eventExtractionPaths'

const ROOT_ARRAY_INDEX = /^\$\[[\d*]+\]/

function pathReferencesPrefix(path: string, prefix: string): boolean {
  if (!prefix) return false
  if (path === prefix) return true
  if (path.startsWith(`${prefix}.`)) return true
  if (path.startsWith(`${prefix}[`)) return true
  return false
}

/** True when a mapping JSONPath still references the raw response envelope. */
export function isEnvelopeRelativeMappingPath(
  mappingPath: string,
  eventArrayPath: string,
  eventRootPath = '',
): boolean {
  const path = mappingPath.trim()
  if (!path) return false

  const arrayNorm = normalizeEventArrayPath(eventArrayPath) || '$'
  const root = normalizeEventRootPath(eventRootPath)

  if (arrayNorm === '$') {
    if (ROOT_ARRAY_INDEX.test(path)) return true
  } else {
    for (const prefix of [arrayNorm, `${arrayNorm}[0]`, `${arrayNorm}[*]`]) {
      if (pathReferencesPrefix(path, prefix)) return true
    }
  }

  if (root && pathReferencesPrefix(path, root)) return true
  return false
}

export const ENVELOPE_RELATIVE_MAPPING_PATH_MESSAGE =
  'Mapping paths must be relative to the extracted event, not the raw response envelope.'
