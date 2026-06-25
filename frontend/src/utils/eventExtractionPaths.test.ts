import { describe, expect, it } from 'vitest'
import {
  absolutePathInSampleRecord,
  checkpointPathFromClick,
  eventRootPathFromClick,
  formatCheckpointAppliesTo,
  formatPreviewSamplePath,
  formatRuntimeExtractionPath,
  isPreviewOnlyArrayPath,
  normalizeEventArrayPath,
  normalizeEventRootPath,
  toCheckpointRelativePath,
} from './eventExtractionPaths'

describe('normalizeEventArrayPath', () => {
  it('strips trailing numeric index from array path', () => {
    expect(normalizeEventArrayPath('$.Records[0]')).toBe('$.Records')
    expect(normalizeEventArrayPath('$.data.events[2]')).toBe('$.data.events')
  })

  it('strips wildcard index suffix', () => {
    expect(normalizeEventArrayPath('$.Records[*]')).toBe('$.Records')
  })

  it('normalizes wrapped-quote custom paths', () => {
    expect(normalizeEventArrayPath("'$.data.resultIdToElementDataMap.*'")).toBe('$.data.resultIdToElementDataMap.*')
    expect(normalizeEventRootPath("''")).toBe('')
    expect(normalizeEventRootPath('""')).toBe('')
  })
})

describe('formatRuntimeExtractionPath', () => {
  it('builds wildcard runtime path with event root', () => {
    expect(formatRuntimeExtractionPath('$.Records', '$.event')).toBe('$.Records[*].event')
  })

  it('uses root wildcard for top-level array', () => {
    expect(formatRuntimeExtractionPath('$', '$.roles')).toBe('$[*].roles')
    expect(formatRuntimeExtractionPath('$', '')).toBe('$[*]')
  })
})

describe('formatPreviewSamplePath', () => {
  it('uses index for named array preview', () => {
    expect(formatPreviewSamplePath('$.Records', 0)).toBe('$.Records[0]')
    expect(formatPreviewSamplePath('$.Records', 3)).toBe('$.Records[3]')
  })

  it('uses root index for top-level array', () => {
    expect(formatPreviewSamplePath('$', 0)).toBe('$[0]')
    expect(formatPreviewSamplePath('', 0)).toBe('$[0]')
  })
})

describe('eventRootPathFromClick', () => {
  it('converts root array item object path to relative event root', () => {
    expect(eventRootPathFromClick('$[0].roles', '$')).toBe('$.roles')
  })

  it('converts named array item object path to relative event root', () => {
    expect(eventRootPathFromClick('$.Records[0].event', '$.Records')).toBe('$.event')
  })

  it('converts object-map wildcard dynamic key path to relative event root', () => {
    expect(
      eventRootPathFromClick(
        '$.data.resultIdToElementDataMap.kFrA4R53fMqTQzlG.simpleValues.creationTime',
        '$.data.resultIdToElementDataMap.*',
      ),
    ).toBe('$.simpleValues.creationTime')
    expect(
      eventRootPathFromClick(
        '$.data.resultIdToElementDataMap.kFrA4R53fMqTQzlG',
        '$.data.resultIdToElementDataMap.*',
      ),
    ).toBe('')
  })
})

describe('checkpointPathFromClick', () => {
  it('stores checkpoint relative to record with event root context', () => {
    expect(checkpointPathFromClick('$.Records[0].event.eventTime', '$.Records', 0)).toBe('$.event.eventTime')
    expect(toCheckpointRelativePath('$.Records[0].event.eventTime', '$.Records', '$.event', 0)).toBe(
      '$.event.eventTime',
    )
  })

  it('stores checkpoint on record without event root', () => {
    expect(checkpointPathFromClick('$.Records[0].eventTime', '$.Records', 0)).toBe('$.eventTime')
  })

  it('stores checkpoint for root array sample', () => {
    expect(checkpointPathFromClick('$[0].creationTime', '$', 0)).toBe('$.creationTime')
  })
})

describe('formatCheckpointAppliesTo', () => {
  it('combines runtime array scope with checkpoint field', () => {
    expect(formatCheckpointAppliesTo('$', '$.creationTime')).toBe('$[*].creationTime')
    expect(formatCheckpointAppliesTo('$.Records', '$.event.eventTime')).toBe('$.Records[*].event.eventTime')
  })
})

describe('absolutePathInSampleRecord', () => {
  it('builds absolute highlight path for summary selections', () => {
    expect(absolutePathInSampleRecord('$.Records', '$.event', 0)).toBe('$.Records[0].event')
    expect(absolutePathInSampleRecord('$', '$.roles', 0)).toBe('$[0].roles')
  })
})

describe('isPreviewOnlyArrayPath', () => {
  it('flags indexed array selection', () => {
    expect(isPreviewOnlyArrayPath('$.Records[0]')).toBe(true)
    expect(isPreviewOnlyArrayPath('$.Records')).toBe(false)
  })
})
