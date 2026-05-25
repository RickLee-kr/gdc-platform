import { describe, expect, it } from 'vitest'
import type { MappingRowModel } from '../components/streams/stream-mapping-model'
import { fieldMappingsFromRows, hasBlockingMappingValidationErrors, suggestOutputField, validateMappingRowsLocal } from './mappingValidation'

describe('mappingValidation', () => {
  it('detects duplicate destination fields', () => {
    const rows: MappingRowModel[] = [
      { id: '1', outputField: 'event_id', sourceJsonPath: '$.id', type: 'string', origin: 'manual' },
      { id: '2', outputField: 'Event_ID', sourceJsonPath: '$.guid', type: 'string', origin: 'manual' },
    ]
    const { warnings, rowIssues } = validateMappingRowsLocal(rows)
    expect(warnings.some((w) => w.code === 'DUPLICATE_OUTPUT_FIELD')).toBe(true)
    expect(rowIssues.get('1')?.duplicateOutput).toBe(true)
    expect(rowIssues.get('2')?.duplicateOutput).toBe(true)
  })

  it('flags empty source path when output is set', () => {
    const rows: MappingRowModel[] = [
      { id: '1', outputField: 'title', sourceJsonPath: '', type: 'string', origin: 'manual' },
    ]
    const { warnings } = validateMappingRowsLocal(rows)
    expect(warnings.some((w) => w.code === 'EMPTY_SOURCE_PATH')).toBe(true)
  })

  it('builds field_mappings for backend preview', () => {
    const rows: MappingRowModel[] = [
      { id: '1', outputField: 'a', sourceJsonPath: '$.x', type: 'string', origin: 'manual' },
      { id: '2', outputField: '', sourceJsonPath: '$.y', type: 'string', origin: 'manual' },
    ]
    expect(fieldMappingsFromRows(rows)).toEqual({ a: '$.x' })
  })

  it('suggestOutputField uses last path segment', () => {
    expect(suggestOutputField('$.data.items[0].event_id')).toBe('event_id')
  })

  it('flags envelope-relative mapping paths as blocking errors', () => {
    const rows: MappingRowModel[] = [
      {
        id: '1',
        outputField: 'event_time',
        sourceJsonPath: '$.Records[0].event.eventTime',
        type: 'string',
        origin: 'manual',
      },
    ]
    const { warnings } = validateMappingRowsLocal(rows, {
      eventArrayPath: '$.Records',
      eventRootPath: '$.event',
    })
    expect(warnings.some((w) => w.code === 'ENVELOPE_RELATIVE_MAPPING_PATH' && w.severity === 'error')).toBe(true)
    expect(hasBlockingMappingValidationErrors(warnings)).toBe(true)
  })
})
