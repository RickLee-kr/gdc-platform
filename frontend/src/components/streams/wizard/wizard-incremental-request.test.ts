import { describe, expect, it } from 'vitest'
import {
  applyIncrementalRequestTemplate,
  buildIncrementalRequestTestSignature,
  calculateIncrementalRequestTestCheckpoint,
  collectCheckpointValuesForIncrementalTest,
  collectCheckpointValuesFromEventSource,
  incrementalRequestTestWarning,
  readCheckpointFromEventSourceRecord,
  readCheckpointFromExtractedEvent,
  readCheckpointSampleValue,
  resolveCheckpointPathForExtractedEvent,
  resolveCheckpointPathForRecord,
} from './wizard-incremental-request'

describe('readCheckpointSampleValue', () => {
  const nestedRecord = {
    data: {
      result: [
        {
          elementDataMap: {
            'AP-ID833786762': {
              '0': {
                simpleValues: {
                  creationTime: '2024-06-21T02:00:00.000Z',
                },
              },
            },
          },
        },
      ],
    },
  }

  it('resolves flat checkpoint paths', () => {
    expect(readCheckpointSampleValue({ creationTime: 42 }, '$.creationTime')).toBe(42)
  })

  it('resolves nested paths with array indices', () => {
    expect(
      readCheckpointSampleValue(
        nestedRecord,
        '$.data.result[0].elementDataMap.AP-ID833786762.0.simpleValues.creationTime',
      ),
    ).toBe('2024-06-21T02:00:00.000Z')
  })
})

describe('calculateIncrementalRequestTestCheckpoint', () => {
  const records = [
    { creationTime: 1000 },
    { creationTime: 2000 },
    { creationTime: 3000 },
  ]

  it('uses second-latest checkpoint from Event Source records', () => {
    const values = collectCheckpointValuesFromEventSource(records, '$.creationTime')
    const result = calculateIncrementalRequestTestCheckpoint(values, 'TIMESTAMP')
    expect(result).toMatchObject({
      kind: 'ok',
      value: 2000,
      usedFallback: false,
      latestExcluded: '3000',
    })
  })

  it('falls back to timestamp minus one hour when only one value exists', () => {
    const result = calculateIncrementalRequestTestCheckpoint([1_700_000_000_000], 'TIMESTAMP')
    expect(result).toMatchObject({
      kind: 'ok',
      usedFallback: true,
      value: 1_700_000_000_000 - 3_600_000,
    })
  })

  it('falls back to numeric minus one when only one numeric value exists', () => {
    const result = calculateIncrementalRequestTestCheckpoint([42], 'EVENT_ID')
    expect(result).toMatchObject({
      kind: 'ok',
      usedFallback: true,
      value: 41,
      valueKind: 'numeric',
    })
  })

  it('disables auto-test for unsortable string checkpoint values', () => {
    const result = calculateIncrementalRequestTestCheckpoint(['alpha', 'beta'], 'CURSOR')
    expect(result).toEqual({
      kind: 'unsortable_string',
      reason: 'Cannot calculate a safe test checkpoint from this field.',
    })
  })

  it('disables test when no checkpoint values exist', () => {
    const result = calculateIncrementalRequestTestCheckpoint([], 'TIMESTAMP')
    expect(result.kind).toBe('disabled')
  })

  it('collects nested checkpoint values for incremental request tests', () => {
    const nestedRecords = [
      {
        data: {
          result: [{ simpleValues: { creationTime: '2024-06-20T02:00:00.000Z' } }],
        },
      },
      {
        data: {
          result: [{ simpleValues: { creationTime: '2024-06-21T02:00:00.000Z' } }],
        },
      },
      {
        data: {
          result: [{ simpleValues: { creationTime: '2024-06-22T02:00:00.000Z' } }],
        },
      },
    ]
    const values = collectCheckpointValuesFromEventSource(
      nestedRecords,
      '$.data.result[0].simpleValues.creationTime',
    )
    const result = calculateIncrementalRequestTestCheckpoint(values, 'TIMESTAMP')
    expect(values).toHaveLength(3)
    expect(result).toMatchObject({
      kind: 'ok',
      usedFallback: false,
    })
  })

  it('collects checkpoint values when event root narrows records and path keeps stale array prefix', () => {
    const records = [
      {
        elementDataMap: {
          bf48b53f68e14b14: {
            simpleValues: {
              creationTime: '2024-06-21T02:00:00.000Z',
            },
          },
        },
      },
    ]
    const values = collectCheckpointValuesFromEventSource(
      records,
      '$.data.results[0].elementDataMap.bf48b53f68e14b14.simpleValues.creationTime',
      '$.elementDataMap.bf48b53f68e14b14',
    )
    const result = calculateIncrementalRequestTestCheckpoint(values, 'TIMESTAMP')
    expect(values).toEqual(['2024-06-21T02:00:00.000Z'])
    expect(result).toMatchObject({
      kind: 'ok',
      usedFallback: true,
    })
  })

  it('falls back to event-root tail segments for a single extracted malop record', () => {
    const record = {
      elementDataMap: {
        bf48b53f68e14b14: {
          simpleValues: {
            creationTime: '2024-06-21T02:00:00.000Z',
          },
        },
      },
    }
    expect(
      readCheckpointFromEventSourceRecord(
        record,
        '$.data.results[0].elementDataMap.bf48b53f68e14b14.simpleValues.creationTime',
        '$.elementDataMap.bf48b53f68e14b14',
      ),
    ).toBe('2024-06-21T02:00:00.000Z')
  })
})

describe('collectCheckpointValuesForIncrementalTest', () => {
  it('reads checkpoint from extracted records when path keeps stale array prefix', () => {
    const records = [
      {
        dataMap: {
          'if-b81b84a7b4c': {
            simpleValue: {
              creationTime: '2024-06-21T02:00:00.000Z',
            },
          },
        },
      },
    ]
    const values = collectCheckpointValuesForIncrementalTest({
      records,
      checkpointSourcePath: '$.data.results[0].dataMap.if-b81b84a7b4c.simpleValue.creationTime',
      eventArrayPath: '$.data.results',
      previewRecord: records[0],
    })
    expect(values).toEqual(['2024-06-21T02:00:00.000Z'])
    expect(calculateIncrementalRequestTestCheckpoint(values, 'TIMESTAMP')).toMatchObject({
      kind: 'ok',
      usedFallback: true,
    })
  })

  it('resolveCheckpointPathForRecord strips event array sample prefix', () => {
    expect(
      resolveCheckpointPathForRecord(
        '$.data.results[0].dataMap.if-b81b84a7b4c.simpleValue.creationTime',
        '$.data.results',
      ),
    ).toBe('$.dataMap.if-b81b84a7b4c.simpleValue.creationTime')
  })

  it('falls back to preview record for a single sample', () => {
    const preview = { creationTime: '2024-06-21T02:00:00.000Z' }
    const values = collectCheckpointValuesForIncrementalTest({
      records: [],
      checkpointSourcePath: '$.creationTime',
      eventArrayPath: '$',
      previewRecord: preview,
    })
    expect(values).toEqual(['2024-06-21T02:00:00.000Z'])
  })

  it('reads createdAtTime from extracted malop when event root and stale checkpoint prefix are set', () => {
    const extracted = {
      createdAtTime: '2024-06-21T02:00:00.000Z',
      simpleValues: { elementId: 'abc' },
    }
    const values = collectCheckpointValuesForIncrementalTest({
      records: [extracted],
      checkpointSourcePath:
        '$.data.results[0].elementDataMap.bf9cd3196f7b1c518af6f45e6.createdAtTime',
      eventArrayPath: '$',
      eventRootPath: '$.data.results[0].elementDataMap.bf9cd3196f7b1c518af6f45e6',
      previewRecord: extracted,
    })
    expect(values).toEqual(['2024-06-21T02:00:00.000Z'])
    expect(calculateIncrementalRequestTestCheckpoint(values, 'TIMESTAMP')).toMatchObject({
      kind: 'ok',
      usedFallback: true,
    })
  })

  it('resolveCheckpointPathForExtractedEvent maps checkpoint to $.createdAtTime on malop object', () => {
    expect(
      resolveCheckpointPathForExtractedEvent(
        '$.data.results[0].elementDataMap.bf9cd3196f7b1c518af6f45e6.createdAtTime',
        '$',
        '$.data.results[0].elementDataMap.bf9cd3196f7b1c518af6f45e6',
      ),
    ).toBe('$.createdAtTime')
  })
})

describe('incrementalRequestTestWarning', () => {
  const base = {
    pattern: 'json_body' as const,
    draft: '{"from":"{{checkpoint.last_timestamp}}"}',
    checkpointSourcePath: '$.creationTime',
    eventArrayPath: '$.data',
  }

  it('warns when incremental body was not tested', () => {
    const warn = incrementalRequestTestWarning({
      ...base,
      lastSuccessSignature: null,
      lastSuccessAt: null,
    })
    expect(warn.level).toBe('warning')
  })

  it('invalidates warning after successful test signature matches', () => {
    const signature = buildIncrementalRequestTestSignature(base)
    const warn = incrementalRequestTestWarning({
      ...base,
      lastSuccessSignature: signature,
      lastSuccessAt: Date.now(),
    })
    expect(warn.level).toBe('none')
  })

  it('warns when request body changed after last successful test', () => {
    const signature = buildIncrementalRequestTestSignature(base)
    const warn = incrementalRequestTestWarning({
      ...base,
      draft: '{"from":"{{checkpoint.last_timestamp}}","limit":50}',
      lastSuccessSignature: signature,
      lastSuccessAt: Date.now(),
    })
    expect(warn.level).toBe('warning')
  })
})

describe('applyIncrementalRequestTemplate', () => {
  it('keeps template placeholders in saved stream body', () => {
    const draft = JSON.stringify({
      from: '{{checkpoint.last_timestamp}}',
      to: '{{now}}',
      limit: 100,
    })
    const merged = applyIncrementalRequestTemplate(
      { method: 'GET', params: {} },
      'json_body',
      draft,
    )
    expect(merged.body).toContain('{{checkpoint.last_timestamp}}')
    expect(merged.body).toContain('{{now}}')
    expect(merged.body).not.toContain('1700000000000')
  })
})
