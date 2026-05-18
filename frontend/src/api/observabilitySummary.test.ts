import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import {
  clearObservabilitySummaryCache,
  fetchObservabilitySummary,
  observabilitySummaryRequestKey,
} from './observabilitySummary'

const summary = (snapshotId: string) => ({
  snapshot_id: snapshotId,
  generated_at: snapshotId,
  window: '1h',
  window_start: '2026-01-01T00:00:00Z',
  window_end: '2026-01-01T01:00:00Z',
  metric_contract_version: 'v1',
  totals: {
    streams_total: 0,
    streams_running: 0,
    routes_total: 0,
    routes_enabled: 0,
    healthy_routes: 0,
    idle_routes: 0,
    unhealthy_routes: 0,
    critical_routes: 0,
    delivery_success_events: 0,
    delivery_failed_events: 0,
    retry_success_events: 0,
    retry_failed_events: 0,
    runtime_telemetry_rows: 0,
    lifecycle_rows: 0,
    processed_events: 0,
    throughput_eps: 0,
    p95_latency_ms: null,
  },
  metric_contract: {},
  metric_meta: {},
})

describe('observability summary request cache', () => {
  beforeEach(() => {
    clearObservabilitySummaryCache()
    vi.restoreAllMocks()
  })

  it('deduplicates duplicate consumers for the same window and snapshot', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('2026-01-01T01:00:00Z') as Awaited<ReturnType<typeof fetchObservabilitySummary>>)

    const [first, second] = await Promise.all([
      fetchObservabilitySummary('1h', { snapshot_id: '2026-01-01T01:00:00Z' }),
      fetchObservabilitySummary('1h', { snapshot_id: '2026-01-01T01:00:00Z' }),
    ])

    expect(first?.snapshot_id).toBe('2026-01-01T01:00:00Z')
    expect(second?.snapshot_id).toBe('2026-01-01T01:00:00Z')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reuses the settled response for the same snapshot key', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('2026-01-01T02:00:00Z') as Awaited<ReturnType<typeof fetchObservabilitySummary>>)

    await fetchObservabilitySummary('24h', { snapshot_id: '2026-01-01T02:00:00Z' })
    await fetchObservabilitySummary('24h', { snapshot_id: '2026-01-01T02:00:00Z' })

    expect(observabilitySummaryRequestKey('24h', '2026-01-01T02:00:00Z')).toBe('24h:2026-01-01T02:00:00Z')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('invalidates by key when the window changes', async () => {
    const spy = vi
      .spyOn(rawApi, 'safeRequestJson')
      .mockResolvedValue(summary('2026-01-01T03:00:00Z') as Awaited<ReturnType<typeof fetchObservabilitySummary>>)

    await fetchObservabilitySummary('1h', { snapshot_id: '2026-01-01T03:00:00Z' })
    await fetchObservabilitySummary('15m', { snapshot_id: '2026-01-01T03:00:00Z' })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(String(spy.mock.calls[0]?.[0])).toContain('window=1h')
    expect(String(spy.mock.calls[1]?.[0])).toContain('window=15m')
  })
})
