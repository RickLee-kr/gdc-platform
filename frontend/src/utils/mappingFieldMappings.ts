import type { MappingRowModel } from '../components/streams/stream-mapping-model'

export type FieldMappingValue = string

export function fieldMappingsFromRows(rows: MappingRowModel[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const k = row.outputField.trim()
    const p = row.sourceJsonPath.trim()
    if (!k || !p) continue
    out[k] = p
  }
  return out
}

export function rowsFromFieldMappings(fieldMappings: Record<string, unknown>): MappingRowModel[] {
  let i = 0
  const rows: MappingRowModel[] = []
  for (const [outputField, raw] of Object.entries(fieldMappings)) {
    if (typeof raw === 'string') {
      rows.push({
        id: `m-${i++}-${outputField}`,
        outputField,
        sourceJsonPath: raw,
        type: 'string',
        origin: 'auto',
      })
      continue
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      const path = String(obj.source_json_path ?? obj.json_path ?? '')
      rows.push({
        id: `m-${i++}-${outputField}`,
        outputField: String(obj.output_field ?? outputField),
        sourceJsonPath: path,
        type: 'string',
        origin: 'auto',
      })
    }
  }
  return rows
}
