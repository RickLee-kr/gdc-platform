import type { MappingRowModel } from '../components/streams/stream-mapping-model'
import { normalizeTransformChain, type MappingTransformStep } from './mappingTransforms'

export type FieldMappingValue =
  | string
  | { source_json_path: string; transforms?: MappingTransformStep[] }

export function fieldMappingsFromRows(rows: MappingRowModel[]): Record<string, FieldMappingValue> {
  const out: Record<string, FieldMappingValue> = {}
  for (const row of rows) {
    const k = row.outputField.trim()
    const p = row.sourceJsonPath.trim()
    if (!k || !p) continue
    const transforms = normalizeTransformChain(row.transforms ?? [])
    if (transforms.length > 0) {
      out[k] = { source_json_path: p, transforms }
    } else {
      out[k] = p
    }
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
        transforms: [],
      })
      continue
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      const path = String(obj.source_json_path ?? obj.json_path ?? '')
      const transforms = normalizeTransformChain(obj.transforms)
      rows.push({
        id: `m-${i++}-${outputField}`,
        outputField: String(obj.output_field ?? outputField),
        sourceJsonPath: path,
        type: 'string',
        origin: 'auto',
        transforms,
      })
    }
  }
  return rows
}
