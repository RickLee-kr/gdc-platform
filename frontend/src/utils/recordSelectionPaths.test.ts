import { describe, expect, it } from 'vitest'
import {
  deriveRecordSelectionPaths,
  effectiveEventArrayPath,
  eventArrayPathFromClick,
  normalizeCheckpointRelativePath,
  recordSelectionSummary,
} from './recordSelectionPaths'

const ROOT_ARRAY_PAYLOAD = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]

const CLOUDTRAIL = {
  Records: [{ event: { eventTime: 't1' } }, { event: { eventTime: 't2' } }],
}

describe('effectiveEventArrayPath', () => {
  it('uses $ for root-level object arrays', () => {
    expect(effectiveEventArrayPath('', false, ROOT_ARRAY_PAYLOAD)).toBe('$')
  })

  it('keeps named array paths', () => {
    expect(effectiveEventArrayPath('$.Records', false, CLOUDTRAIL)).toBe('$.Records')
  })
})

describe('eventArrayPathFromClick', () => {
  it('normalizes indexed array click to persisted path', () => {
    expect(eventArrayPathFromClick('$.Records[0]', CLOUDTRAIL)).toBe('$.Records')
  })

  it('uses $ when clicking root array', () => {
    expect(eventArrayPathFromClick('$', ROOT_ARRAY_PAYLOAD)).toBe('$')
    expect(eventArrayPathFromClick('$[0]', ROOT_ARRAY_PAYLOAD)).toBe('$')
  })
})

describe('recordSelectionSummary', () => {
  it('summarizes root array selection', () => {
    const paths = deriveRecordSelectionPaths('$', '', '', false, ROOT_ARRAY_PAYLOAD)
    const summary = recordSelectionSummary(paths, 2, 0)
    expect(summary.eventSource).toBe('$')
    expect(summary.previewSample).toBe('$[0]')
    expect(summary.recordsDetected).toBe('2')
    expect(summary.runtimeExtraction).toBe('$[*]')
  })

  it('summarizes named array with event root', () => {
    const paths = deriveRecordSelectionPaths('$.Records', '$.event', '', false, CLOUDTRAIL)
    const summary = recordSelectionSummary(paths, 2, 0)
    expect(summary.eventSource).toBe('$.Records')
    expect(summary.previewSample).toBe('$.Records[0]')
    expect(summary.runtimeExtraction).toBe('$.Records[*].event')
  })
})

describe('normalizeCheckpointRelativePath', () => {
  it('accepts quoted checkpoint paths from custom input', () => {
    expect(normalizeCheckpointRelativePath("'$.simpleValues.creationTime.values[0]'")).toBe(
      '$.simpleValues.creationTime.values[0]',
    )
    expect(normalizeCheckpointRelativePath("''")).toBe('')
  })
})
