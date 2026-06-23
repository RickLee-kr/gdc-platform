import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHUNK_RELOAD_SESSION_KEY,
  clearChunkReloadGuard,
  isChunkLoadError,
  lazyWithChunkRetry,
} from './lazy-with-chunk-retry'

describe('isChunkLoadError', () => {
  it('detects vite dynamic import failures', () => {
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: https://example/assets/dashboard-overview-abc.js'),
      ),
    ).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
  })
})

describe('lazyWithChunkRetry', () => {
  afterEach(() => {
    clearChunkReloadGuard()
    vi.unstubAllGlobals()
  })

  it('reloads once when a stale chunk import fails', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    const load = lazyWithChunkRetry(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/old.js')),
    )

    void load()
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
    expect(sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY)).toBe('1')
  })

  it('does not reload again when the guard is already set', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1')

    const load = lazyWithChunkRetry(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/old.js')),
    )

    await expect(load()).rejects.toThrow(/dynamically imported module/)
    expect(reload).not.toHaveBeenCalled()
  })
})
