import { describe, expect, it } from 'vitest'
import { WIZARD_STEPS } from '../components/streams/wizard/wizard-state'
import {
  normalizeGdcStreamSourceType,
  resolveSourceTypePresentation,
  resolveStreamSourceTestPageIntro,
  resolveStreamSourceTestShellTitle,
  SOURCE_TEST_SHELL_NEUTRAL_TITLE,
  wizardStepsWithSourcePresentation,
} from './sourceTypePresentation'

describe('normalizeGdcStreamSourceType', () => {
  it('maps known values', () => {
    expect(normalizeGdcStreamSourceType('REMOTE_FILE_POLLING')).toBe('REMOTE_FILE_POLLING')
    expect(normalizeGdcStreamSourceType('s3_object_polling')).toBe('S3_OBJECT_POLLING')
    expect(normalizeGdcStreamSourceType('database_query')).toBe('DATABASE_QUERY')
  })

  it('defaults unknown to HTTP', () => {
    expect(normalizeGdcStreamSourceType('')).toBe('HTTP_API_POLLING')
    expect(normalizeGdcStreamSourceType('KAFKA')).toBe('HTTP_API_POLLING')
  })
})

describe('resolveSourceTypePresentation', () => {
  it('returns distinct API test labels per source', () => {
    expect(resolveSourceTypePresentation('HTTP_API_POLLING').workflow.apiTestShortLabel).toBe('API Test')
    expect(resolveSourceTypePresentation('REMOTE_FILE_POLLING').workflow.apiTestShortLabel).toBe('Remote probe')
    expect(resolveSourceTypePresentation('DATABASE_QUERY').workflow.apiTestShortLabel).toBe('Query test')
    expect(resolveSourceTypePresentation('S3_OBJECT_POLLING').workflow.apiTestShortLabel).toBe('Object preview')
  })

  it('hides HTTP-only summary rows for remote', () => {
    expect(resolveSourceTypePresentation('HTTP_API_POLLING').summary.showHttpEndpointRows).toBe(true)
    expect(resolveSourceTypePresentation('REMOTE_FILE_POLLING').summary.showHttpEndpointRows).toBe(false)
  })

  it('exposes app shell source-test titles per source', () => {
    expect(resolveSourceTypePresentation('HTTP_API_POLLING').appShellSourceTestTitle).toBe('API Test & Preview')
    expect(resolveSourceTypePresentation('REMOTE_FILE_POLLING').appShellSourceTestTitle).toBe('Remote Probe & Preview')
    expect(resolveSourceTypePresentation('DATABASE_QUERY').appShellSourceTestTitle).toBe('Query Test & Preview')
    expect(resolveSourceTypePresentation('S3_OBJECT_POLLING').appShellSourceTestTitle).toBe('Object Preview')
  })
})

describe('wizardStepsWithSourcePresentation', () => {
  it('renames stream and api_test steps for remote file polling', () => {
    const steps = wizardStepsWithSourcePresentation(WIZARD_STEPS, 'REMOTE_FILE_POLLING')
    expect(steps.find((s) => s.key === 'stream')?.title).toBe('Remote files')
    expect(steps.find((s) => s.key === 'api_test')?.title).toBe('Remote probe')
    expect(steps.find((s) => s.key === 'preview')?.title).toBe('Sample preview')
  })

  it('keeps HTTP-oriented titles for HTTP_API_POLLING', () => {
    const steps = wizardStepsWithSourcePresentation(WIZARD_STEPS, 'HTTP_API_POLLING')
    expect(steps.find((s) => s.key === 'stream')?.title).toBe('HTTP Request')
    expect(steps.find((s) => s.key === 'api_test')?.title).toBe('API Test')
  })
})

describe('resolveStreamSourceTestShellTitle', () => {
  it('uses slug hints for fixture stream ids', () => {
    expect(resolveStreamSourceTestShellTitle('malop-api', null)).toBe('API Test & Preview')
    expect(resolveStreamSourceTestShellTitle('fixture-remote-stream', null)).toBe('Remote Probe & Preview')
    expect(resolveStreamSourceTestShellTitle('fixture-db-stream', null)).toBe('Query Test & Preview')
    expect(resolveStreamSourceTestShellTitle('fixture-s3-stream', null)).toBe('Object Preview')
  })

  it('prefers API source type over slug map', () => {
    expect(resolveStreamSourceTestShellTitle('malop-api', 'S3_OBJECT_POLLING')).toBe('Object Preview')
  })

  it('falls back to neutral title when unknown', () => {
    expect(resolveStreamSourceTestShellTitle('unknown-stream-slug', null)).toBe(SOURCE_TEST_SHELL_NEUTRAL_TITLE)
    expect(resolveStreamSourceTestShellTitle(undefined, null)).toBe(SOURCE_TEST_SHELL_NEUTRAL_TITLE)
  })
})

describe('resolveStreamSourceTestPageIntro', () => {
  it('returns neutral intro when no API type and no slug hint', () => {
    expect(resolveStreamSourceTestPageIntro('no-hint-slug', null)).toMatch(/numeric stream id/i)
  })
})
