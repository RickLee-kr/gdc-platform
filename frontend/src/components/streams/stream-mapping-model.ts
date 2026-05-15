/** Mapping workspace view-model types and empty shell (API-backed when stream id is numeric). */

export type MappingFieldType = 'string' | 'number' | 'datetime'

export type MappingRowModel = {
  id: string
  sourceJsonPath: string
  outputField: string
  type: MappingFieldType
  origin: 'auto' | 'manual'
}

export type EnrichmentRowModel = {
  field: string
  value: string
  type: 'static' | 'function'
}

export type FieldLibraryGroup = {
  id: string
  label: string
  count: number
}

export type FunctionCardModel = {
  name: string
  signature: string
  description: string
  category: 'string' | 'number' | 'date' | 'logic' | 'array' | 'other'
}

const FIELD_LIBRARY: readonly FieldLibraryGroup[] = [
  { id: 'common', label: 'Common', count: 24 },
  { id: 'cybereason-malop', label: 'Cybereason (Malop)', count: 18 },
  { id: 'host', label: 'Host Information', count: 12 },
  { id: 'file', label: 'File / Hash', count: 9 },
  { id: 'network', label: 'Network', count: 7 },
]

export const MAPPING_FUNCTION_CARDS: readonly FunctionCardModel[] = [
  { name: 'concat', signature: 'concat(a, b, …)', description: 'Join strings safely with an optional delimiter.', category: 'string' },
  { name: 'lower', signature: 'lower(s)', description: 'Lowercase a string value.', category: 'string' },
  { name: 'upper', signature: 'upper(s)', description: 'Uppercase a string value.', category: 'string' },
  { name: 'coalesce', signature: 'coalesce(a, b, …)', description: 'First non-empty value.', category: 'logic' },
  { name: 'format_date', signature: 'format_date(ts, tz)', description: 'Format timestamps for SIEM consumers.', category: 'date' },
  { name: 'json_extract', signature: 'json_extract(obj, path)', description: 'Extract nested JSON safely.', category: 'other' },
  { name: 'if', signature: 'if(cond, a, b)', description: 'Conditional mapping branches.', category: 'logic' },
  { name: 'to_string', signature: 'to_string(v)', description: 'Normalize values to string.', category: 'string' },
]

export type StreamMappingPageState = {
  streamId: string
  streamName: string
  connectorName: string
  status: 'RUNNING'
  lastTestRelative: string
  recordsFetched: number
  fetchedAt: string
  /** Full payload preview for tree + JSONPath resolution (includes `data` array). */
  sourceDocument: Record<string, unknown>
  /** Root object rendered in the JSON tree. */
  sampleRecord: Record<string, unknown>
  initialMappings: readonly MappingRowModel[]
  enrichment: readonly EnrichmentRowModel[]
  fieldLibrary: readonly FieldLibraryGroup[]
  stats: { autoMapped: number; manualMapped: number; unmapped: number }
}

/** Empty shell when stream id is missing or mapping-ui config cannot be loaded. */
export function emptyStreamMappingPageState(streamId: string): StreamMappingPageState {
  const streamName = /^\d+$/.test(streamId) ? `Stream ${streamId}` : streamId || 'Stream'
  return {
    streamId: streamId || '—',
    streamName,
    connectorName: '—',
    status: 'RUNNING',
    lastTestRelative: '—',
    recordsFetched: 0,
    fetchedAt: '—',
    sourceDocument: {},
    sampleRecord: {},
    initialMappings: [],
    enrichment: [],
    fieldLibrary: [...FIELD_LIBRARY],
    stats: { autoMapped: 0, manualMapped: 0, unmapped: 0 },
  }
}
