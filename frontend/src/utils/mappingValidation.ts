import type { MappingRowModel } from '../components/streams/stream-mapping-model'
import {
  ENVELOPE_RELATIVE_MAPPING_PATH_MESSAGE,
  isEnvelopeRelativeMappingPath,
} from './mappingPathValidation'

export type MappingValidationWarning = {
  code: string
  severity: 'error' | 'warning'
  message: string
  output_field?: string | null
  json_path?: string | null
  event_index?: number | null
}

export type MappingRowIssue = {
  duplicateOutput: boolean
  emptySource: boolean
  emptyOutput: boolean
  emptyExtraction: boolean
  envelopeRelativePath: boolean
}

export type ValidateMappingRowsOptions = {
  eventArrayPath?: string
  eventRootPath?: string
}

/** Client-side checks before / while backend validate runs. */
export function validateMappingRowsLocal(
  rows: MappingRowModel[],
  options: ValidateMappingRowsOptions = {},
): {
  warnings: MappingValidationWarning[]
  rowIssues: Map<string, MappingRowIssue>
} {
  const eventArrayPath = options.eventArrayPath ?? ''
  const eventRootPath = options.eventRootPath ?? ''
  const warnings: MappingValidationWarning[] = []
  const rowIssues = new Map<string, MappingRowIssue>()
  const outputCounts = new Map<string, number>()

  for (const row of rows) {
    const out = row.outputField.trim()
    if (out) outputCounts.set(out.toLowerCase(), (outputCounts.get(out.toLowerCase()) ?? 0) + 1)
  }

  const duplicateOutputs = new Set<string>()
  for (const [k, n] of outputCounts) {
    if (n > 1) duplicateOutputs.add(k)
  }

  for (const row of rows) {
    const out = row.outputField.trim()
    const path = row.sourceJsonPath.trim()
    const dup = out ? duplicateOutputs.has(out.toLowerCase()) : false
    const emptySource = !path
    const emptyOutput = !out
    const envelopeRelativePath =
      Boolean(path) &&
      isEnvelopeRelativeMappingPath(path, eventArrayPath, eventRootPath)
    rowIssues.set(row.id, {
      duplicateOutput: dup,
      emptySource,
      emptyOutput,
      emptyExtraction: false,
      envelopeRelativePath,
    })
    if (dup) {
      warnings.push({
        code: 'DUPLICATE_OUTPUT_FIELD',
        severity: 'warning',
        message: `Destination field "${out}" is used on more than one mapping row.`,
        output_field: out,
      })
    }
    if (emptyOutput && path) {
      warnings.push({
        code: 'EMPTY_OUTPUT_FIELD',
        severity: 'warning',
        message: 'Mapping row has a source path but no destination field name.',
        json_path: path,
      })
    }
    if (emptySource && out) {
      warnings.push({
        code: 'EMPTY_SOURCE_PATH',
        severity: 'warning',
        message: `Destination field "${out}" has no source JSONPath.`,
        output_field: out,
      })
    }
    if (envelopeRelativePath) {
      warnings.push({
        code: 'ENVELOPE_RELATIVE_MAPPING_PATH',
        severity: 'error',
        message: ENVELOPE_RELATIVE_MAPPING_PATH_MESSAGE,
        output_field: out || undefined,
        json_path: path,
      })
    }
  }

  return { warnings, rowIssues }
}

export { fieldMappingsFromRows } from './mappingFieldMappings'

export function hasBlockingMappingValidationErrors(warnings: MappingValidationWarning[]): boolean {
  return warnings.some((w) => w.severity === 'error')
}

export function mergeValidationWarnings(
  local: MappingValidationWarning[],
  backend: MappingValidationWarning[],
): MappingValidationWarning[] {
  const seen = new Set<string>()
  const merged: MappingValidationWarning[] = []
  for (const w of [...local, ...backend]) {
    const key = `${w.code}|${w.output_field ?? ''}|${w.json_path ?? ''}|${w.event_index ?? ''}|${w.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(w)
  }
  return merged
}

export function suggestOutputField(jsonPath: string): string {
  const stripped = jsonPath.replace(/^\$\.?/, '')
  const parts = stripped.split(/\.|\[|\]/).filter(Boolean)
  const last = parts[parts.length - 1] ?? 'field'
  const cleaned = last.replace(/[^a-zA-Z0-9_]/g, '_')
  return cleaned || 'field'
}
