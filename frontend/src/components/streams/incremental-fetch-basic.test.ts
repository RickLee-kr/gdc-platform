import { describe, expect, it } from 'vitest'
import {
  applyBasicIncrementalField,
  buildIncrementalFieldCandidates,
  buildIncrementalFieldOptions,
  detectAdvancedOverride,
  filterIncrementalFieldOptions,
  isCursorFieldName,
  isTimestampFieldName,
  pickDefaultIncrementalField,
  recommendIncrementalFields,
  resolveIncrementalFetchStrategy,
  syncSafetyLabel,
} from './incremental-fetch-basic'
import type { IncrementalFetchConfigValues } from './incremental-fetch-config-model'
import {
  buildIncrementalFetchConfigJsonPatch,
  readIncrementalFetchFromPersisted,
} from './incremental-fetch-config-model'

const emptyValues = (): IncrementalFetchConfigValues => ({
  strategy: '',
  watermarkField: '',
  cursorField: '',
  tieBreakerField: '',
  stabilityLagSeconds: 120,
  initialLookbackSeconds: 86400,
  advancedOverride: false,
})

describe('incremental-fetch-basic', () => {
  it('detects timestamp and cursor field names', () => {
    expect(isTimestampFieldName('updated_at')).toBe(true)
    expect(isTimestampFieldName('$.lastModifiedTime')).toBe(true)
    expect(isTimestampFieldName('created_at')).toBe(true)
    expect(isTimestampFieldName('createdTime')).toBe(true)
    expect(isCursorFieldName('next_cursor')).toBe(true)
    expect(isCursorFieldName('pageToken')).toBe(true)
  })

  it('recommends update fields before created_at', () => {
    const ranked = recommendIncrementalFields([
      { path: 'created_at', sampleValue: '2026-01-01T00:00:00Z' },
      { path: 'updated_at', sampleValue: '2026-01-02T00:00:00Z' },
      { path: 'id', sampleValue: 'abc' },
    ])
    expect(ranked[0]?.leaf).toBe('updated_at')
    expect(pickDefaultIncrementalField(ranked.map((r) => ({ path: r.path })))).toContain('updated_at')
  })

  it('auto-selects closed_window_watermark for timestamp fields', () => {
    expect(
      resolveIncrementalFetchStrategy({ incrementalField: '$.updated_at' }),
    ).toBe('closed_window_watermark')
  })

  it('auto-selects cursor when cursor field is chosen', () => {
    expect(resolveIncrementalFetchStrategy({ incrementalField: '$.next_cursor' })).toBe('cursor')
  })

  it('keeps manual strategy when advanced override is enabled', () => {
    expect(
      resolveIncrementalFetchStrategy({
        incrementalField: '$.updated_at',
        advancedOverride: true,
        manualStrategy: 'timestamp_watermark',
      }),
    ).toBe('timestamp_watermark')
  })

  it('maps basic field selection onto config_json-compatible values', () => {
    const next = applyBasicIncrementalField('updated_at', emptyValues())
    expect(next.strategy).toBe('closed_window_watermark')
    expect(next.watermarkField).toBe('$.updated_at')
    expect(next.stabilityLagSeconds).toBe(120)
    expect(next.advancedOverride).toBe(false)
  })

  it('detects advanced override when strategy differs from auto', () => {
    expect(
      detectAdvancedOverride({
        strategy: 'timestamp_watermark',
        watermarkField: '$.updated_at',
        cursorField: '',
      }),
    ).toBe(true)
    expect(
      detectAdvancedOverride({
        strategy: 'closed_window_watermark',
        watermarkField: '$.updated_at',
        cursorField: '',
      }),
    ).toBe(false)
  })

  it('exposes sync safety copy for closed-window', () => {
    expect(syncSafetyLabel('closed_window_watermark', 120)).toContain('120 seconds')
  })

  it('builds full-field options with recommendations first and keeps selected path', () => {
    const candidates = buildIncrementalFieldCandidates({
      unionSchemaFields: [
        { field_path: '$.user.email', field_type: 'string', sample_values: ['a@test.com'] },
        { field_path: '$.updated_at', field_type: 'string', sample_values: ['2026-01-01T00:00:00Z'] },
        { field_path: '$.meta', field_type: 'object', sample_values: [] },
        { field_path: '$.locale', field_type: 'string', sample_values: ['en'] },
      ],
      sampleFields: [{ path: '$.marker_id', sampleValue: 'x' }],
      selectedPath: '$.rare.custom',
    })
    expect(candidates.map((c) => c.path)).toEqual(
      expect.arrayContaining(['$.updated_at', '$.user.email', '$.locale', '$.marker_id', '$.rare.custom']),
    )
    expect(candidates.map((c) => c.path)).not.toContain('$.meta')

    const options = buildIncrementalFieldOptions(candidates, '$.rare.custom')
    expect(options[0]?.path).toBe('$.updated_at')
    expect(options[0]?.label).toContain('—')
    expect(options.some((o) => o.path === '$.user.email' && !o.recommended)).toBe(true)
    expect(options.some((o) => o.path === '$.rare.custom')).toBe(true)
    expect(filterIncrementalFieldOptions(options, 'email').map((o) => o.path)).toEqual(['$.user.email'])
  })
})

describe('incremental-fetch-config-model persistence', () => {
  it('builds and reads incremental_fetch without changing schema keys', () => {
    const patch = buildIncrementalFetchConfigJsonPatch({
      incrementalFetchStrategy: 'closed_window_watermark',
      incrementalFetchWatermarkField: '$.updated_at',
      incrementalFetchCursorField: '',
      incrementalFetchTieBreakerField: '',
      incrementalFetchStabilityLagSeconds: 120,
      incrementalFetchInitialLookbackSeconds: 86400,
    })
    expect(patch).toEqual({
      incremental_fetch: {
        strategy: 'closed_window_watermark',
        watermark_field: '$.updated_at',
        stability_lag_seconds: 120,
        initial_lookback_seconds: 86400,
      },
    })

    const hydrated = readIncrementalFetchFromPersisted(patch!)
    expect(hydrated.incrementalFetchStrategy).toBe('closed_window_watermark')
    expect(hydrated.incrementalFetchWatermarkField).toBe('$.updated_at')
    expect(hydrated.incrementalFetchStabilityLagSeconds).toBe(120)
    expect(hydrated.incrementalFetchAdvancedOverride).toBe(false)
  })
})
