import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import {
  connectorOperationsSummaryRequestKey,
  fetchConnectorOperationsSummary,
} from './gdcConnectorsOperations'
import { clearSharedRequestCache } from './requestCache'

const summary = (window: string) => ({
  window,
  generated_at: '2026-01-01T00:00:00Z',
  connectors: [],
})

const OPERATIONS_SUMMARY_CACHE_NAMESPACE = 'connectors-operations-summary'

describe('connector operations summary request cache', () => {
  beforeEach(() => {
    clearSharedRequestCache(OPERATIONS_SUMMARY_CACHE_NAMESPACE)
    vi.restoreAllMocks()
  })

  it('deduplicates in-flight requests for the same window', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('1h') as Awaited<ReturnType<typeof fetchConnectorOperationsSummary>>)

    const [first, second] = await Promise.all([
      fetchConnectorOperationsSummary('1h'),
      fetchConnectorOperationsSummary('1h'),
    ])

    expect(first?.window).toBe('1h')
    expect(second?.window).toBe('1h')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reuses the settled response within TTL for the same window key', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('1h') as Awaited<ReturnType<typeof fetchConnectorOperationsSummary>>)

    await fetchConnectorOperationsSummary('1h')
    await fetchConnectorOperationsSummary('1h')

    expect(connectorOperationsSummaryRequestKey('1h')).toBe('1h')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('uses separate cache keys per window', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('1h') as Awaited<ReturnType<typeof fetchConnectorOperationsSummary>>)

    await fetchConnectorOperationsSummary('1h')
    await fetchConnectorOperationsSummary('24h')

    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[0]?.[0])).toContain('window=1h')
    expect(String(spy.mock.calls[1]?.[0])).toContain('window=24h')
  })

  it('does not surface AbortError to callers', async () => {
    const controller = new AbortController()
    const spy = vi.spyOn(rawApi, 'safeRequestJson').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(summary('1h')), 50)
        }),
    )

    const pending = fetchConnectorOperationsSummary('1h', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    spy.mockResolvedValue(summary('1h') as Awaited<ReturnType<typeof fetchConnectorOperationsSummary>>)
    await expect(fetchConnectorOperationsSummary('1h')).resolves.toEqual(summary('1h'))
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
