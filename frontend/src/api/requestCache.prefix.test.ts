import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedRequest, clearSharedRequestCache, clearSharedRequestCacheByKeyPrefix } from './requestCache'
import { clearDestinationHealthCache } from './gdcRuntimeHealth'

describe('shared request cache prefix clear', () => {
  beforeEach(() => {
    clearSharedRequestCache()
  })

  it('clears only matching key prefixes', async () => {
    await cachedRequest('runtime-health', 'destinations:window=1h', async () => 'd')
    await cachedRequest('runtime-health', 'routes:window=1h', async () => 'r')
    clearSharedRequestCacheByKeyPrefix('runtime-health', 'destinations:')
    const destLoader = vi.fn(async () => 'd2')
    const routeLoader = vi.fn(async () => 'r2')
    await expect(cachedRequest('runtime-health', 'destinations:window=1h', destLoader)).resolves.toBe('d2')
    await expect(cachedRequest('runtime-health', 'routes:window=1h', routeLoader)).resolves.toBe('r')
    expect(destLoader).toHaveBeenCalledTimes(1)
    expect(routeLoader).not.toHaveBeenCalled()
  })

  it('clearDestinationHealthCache does not wipe route health keys', async () => {
    await cachedRequest('runtime-health', 'destinations:a', async () => 'd')
    await cachedRequest('runtime-health', 'routes:a', async () => 'r')
    clearDestinationHealthCache()
    const destLoader = vi.fn(async () => 'd2')
    const routeLoader = vi.fn(async () => 'r2')
    await expect(cachedRequest('runtime-health', 'destinations:a', destLoader)).resolves.toBe('d2')
    await expect(cachedRequest('runtime-health', 'routes:a', routeLoader)).resolves.toBe('r')
    expect(routeLoader).not.toHaveBeenCalled()
  })
})
