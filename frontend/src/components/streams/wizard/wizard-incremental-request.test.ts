import { describe, expect, it } from 'vitest'
import {
  applyIncrementalRequestTemplate,
  buildIncrementalRequestTestSignature,
  calculateIncrementalRequestTestCheckpoint,
  collectCheckpointValuesFromEventSource,
  incrementalRequestTestWarning,
} from './wizard-incremental-request'

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
