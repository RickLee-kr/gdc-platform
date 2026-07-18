/** Mapping coverage + schema path diff for wizard sample → mapped output. */

export type MappingCoverageStats = {
  sampleFieldCount: number
  mappedSourceCount: number
  unmappedSourceCount: number
  coveragePct: number | null
}

export type SchemaDiffRow = {
  path: string
  kind: 'mapped' | 'unmapped' | 'added'
}

function topLevelKeys(sample: Record<string, unknown> | null): string[] {
  if (!sample) return []
  return Object.keys(sample).sort()
}

function sourceFieldFromJsonPath(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const withoutRoot = trimmed.replace(/^\$\.?/, '')
  if (!withoutRoot) return null
  const first = withoutRoot.split(/[.\[\]]/).filter(Boolean)[0]
  return first ?? null
}

export function computeMappingCoverage(input: {
  sample: Record<string, unknown> | null
  mappingRows: ReadonlyArray<{ sourceJsonPath: string; outputField: string }>
}): MappingCoverageStats {
  const sampleKeys = topLevelKeys(input.sample)
  const mappedSources = new Set<string>()
  for (const row of input.mappingRows) {
    if (!row.outputField.trim() || !row.sourceJsonPath.trim()) continue
    const field = sourceFieldFromJsonPath(row.sourceJsonPath)
    if (field) mappedSources.add(field)
  }
  const mappedSourceCount = sampleKeys.filter((k) => mappedSources.has(k)).length
  const unmappedSourceCount = Math.max(0, sampleKeys.length - mappedSourceCount)
  const coveragePct =
    sampleKeys.length === 0 ? null : Math.round((mappedSourceCount / sampleKeys.length) * 1000) / 10
  return {
    sampleFieldCount: sampleKeys.length,
    mappedSourceCount,
    unmappedSourceCount,
    coveragePct,
  }
}

export function computeSchemaDiff(input: {
  sample: Record<string, unknown> | null
  mappedOutput: Record<string, unknown> | null
  mappingRows: ReadonlyArray<{ sourceJsonPath: string; outputField: string }>
}): SchemaDiffRow[] {
  const sampleKeys = new Set(topLevelKeys(input.sample))
  const outputKeys = new Set(topLevelKeys(input.mappedOutput))
  const mappedSources = new Set<string>()
  for (const row of input.mappingRows) {
    if (!row.outputField.trim() || !row.sourceJsonPath.trim()) continue
    const field = sourceFieldFromJsonPath(row.sourceJsonPath)
    if (field) mappedSources.add(field)
  }

  const rows: SchemaDiffRow[] = []
  for (const path of [...sampleKeys].sort()) {
    rows.push({ path, kind: mappedSources.has(path) ? 'mapped' : 'unmapped' })
  }
  for (const path of [...outputKeys].sort()) {
    if (!sampleKeys.has(path)) rows.push({ path, kind: 'added' })
  }
  return rows
}
