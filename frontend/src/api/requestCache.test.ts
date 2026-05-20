import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedRequest, clearSharedRequestCache } from './requestCache'

describe('shared request cache', () => {
  beforeEach(() => {
    clearSharedRequestCache()
    vi.restoreAllMocks()
  })

  it('deduplicates in-flight requests for the same namespace and key', async () => {
    const loader = vi.fn(async () => 'ok')

    const [first, second] = await Promise.all([
      cachedRequest('routes-runtime', 'same-key', loader),
      cachedRequest('routes-runtime', 'same-key', loader),
    ])

    expect(first).toBe('ok')
    expect(second).toBe('ok')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('keeps namespaces isolated', async () => {
    const loader = vi.fn(async () => 'ok')

    await cachedRequest('routes-runtime-a', 'same-key', loader)
    await cachedRequest('routes-runtime-b', 'same-key', loader)

    expect(loader).toHaveBeenCalledTimes(2)
  })
})
