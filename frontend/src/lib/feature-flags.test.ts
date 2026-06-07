import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDevValidationLabUiEnabled, isInternalOperatorUiEnabled, isOssReleaseMode } from './feature-flags'

describe('feature-flags OSS release mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults OSS mode off in test/dev when unset', () => {
    vi.stubEnv('VITE_OSS_RELEASE_MODE', '')
    expect(isOssReleaseMode()).toBe(false)
  })

  it('enables OSS mode when VITE_OSS_RELEASE_MODE=true', () => {
    vi.stubEnv('VITE_OSS_RELEASE_MODE', 'true')
    expect(isOssReleaseMode()).toBe(true)
    expect(isInternalOperatorUiEnabled()).toBe(false)
    expect(isDevValidationLabUiEnabled()).toBe(false)
  })

  it('disables OSS mode when VITE_OSS_RELEASE_MODE=false', () => {
    vi.stubEnv('VITE_OSS_RELEASE_MODE', 'false')
    expect(isOssReleaseMode()).toBe(false)
    expect(isInternalOperatorUiEnabled()).toBe(true)
  })
})
