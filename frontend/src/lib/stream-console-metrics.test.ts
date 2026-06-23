import { describe, expect, it } from 'vitest'
import type { StreamConsoleRow } from '../api/streamRows'
import {
  aggregateGroupRates,
  aggregateKnownSuccessPctFallback,
  computeGroupOperationalStats,
  formatGroupHeaderSummary,
  groupHealthLabelFromSeverity,
} from './stream-console-metrics'

function row(partial: Partial<StreamConsoleRow> & Pick<StreamConsoleRow, 'id' | 'name' | 'status'>): StreamConsoleRow {
  return {
    connectorName: 'Office365 Connector',
    connectorProductGroup: 'Office365',
    sourceTypeLabel: 'API',
    runtimeStatsAttempted: true,
    hasRuntimeApiSnapshot: true,
    events1h: 100,
    events24h: 0,
    ingestEps: 0,
    eps1m: null,
    eps5m: null,
    successRate5m: null,
    runtimeIssue: null,
    eventsTrend: [1, 2, 3],
    lastCheckpointDisplay: '—',
    lastCheckpointRelative: '—',
    routesTotal: 1,
    routesOk: 1,
    routesDegraded: 0,
    routesError: 0,
    deliveryPct: 100,
    deliveryPctKnown: true,
    latencyP95Ms: 10,
    latencyTrend: [1],
    lastActivityRelative: '1m ago',
    streamType: 'HTTP',
    streamTypeKey: 'HTTP_API_POLLING',
    pollingIntervalSec: 60,
    createdAt: '',
    createdBy: '',
    sourceMethod: 'GET',
    sourceUrl: '',
    authType: '',
    timeoutSec: 30,
    rateLimitLabel: '—',
    checkpointValue: '',
    checkpointUpdatedAt: '',
    checkpointLagLabel: '—',
    recentErrors: [],
    ...partial,
  }
}

describe('stream-console-metrics group operations', () => {
  it('inherits Critical when one stream in group is Critical', () => {
    const stats = computeGroupOperationalStats([
      row({ id: '1', name: 'Healthy', status: 'RUNNING' }),
      row({ id: '2', name: 'Broken', status: 'ERROR', routesError: 1 }),
    ])
    expect(stats.operationalSeverity).toBe('critical')
    expect(groupHealthLabelFromSeverity(stats.operationalSeverity)).toBe('Critical')
    expect(stats.criticalCount).toBe(1)
    expect(stats.warningCount).toBe(0)
  })

  it('inherits Warning when no Critical but one Warning stream exists', () => {
    const stats = computeGroupOperationalStats([
      row({ id: '1', name: 'Healthy', status: 'RUNNING' }),
      row({ id: '2', name: 'Slow', status: 'DEGRADED', routesError: 1, deliveryPct: 80, deliveryPctKnown: true }),
    ])
    expect(stats.operationalSeverity).toBe('warning')
    expect(groupHealthLabelFromSeverity(stats.operationalSeverity)).toBe('Warning')
  })

  it('inherits Stopped when worst stream is Stopped', () => {
    const stats = computeGroupOperationalStats([
      row({ id: '1', name: 'Healthy', status: 'RUNNING' }),
      row({ id: '2', name: 'Paused', status: 'STOPPED' }),
    ])
    expect(stats.operationalSeverity).toBe('stopped')
    expect(groupHealthLabelFromSeverity(stats.operationalSeverity)).toBe('Stopped')
  })

  it('formats group header summary with stream and issue counts', () => {
    const stats = computeGroupOperationalStats([
      row({ id: '1', name: 'A', status: 'RUNNING', events1h: 1_150_000 }),
      row({ id: '2', name: 'B', status: 'ERROR', routesError: 1, events1h: 1_150_000 }),
      row({ id: '3', name: 'C', status: 'DEGRADED', routesError: 1, deliveryPct: 80, deliveryPctKnown: true, events1h: 0 }),
      row({ id: '4', name: 'D', status: 'DEGRADED', routesError: 1, deliveryPct: 85, deliveryPctKnown: true, events1h: 0 }),
    ])
    const summary = formatGroupHeaderSummary(stats)
    expect(summary).toContain('4 Streams')
    expect(summary).toContain('1 Critical')
    expect(summary).toContain('2 Warning')
    expect(summary).toMatch(/2\.3M Events/)
  })

  it('inherits child success rate on group row when throughput weight is zero', () => {
    const rows = [
      row({
        id: '1',
        name: 'Scale Stream 0',
        status: 'RUNNING',
        ingestEps: 0,
        events1h: 0,
        eps1m: 0,
        successRate5m: 99.88,
        deliveryPctKnown: true,
        deliveryPct: 99.88,
      }),
    ]
    expect(aggregateKnownSuccessPctFallback(rows)).toBeCloseTo(99.88, 2)
    const groupMetrics = aggregateGroupRates(rows)
    expect(groupMetrics.successLabel).toBe('99.88%')
    expect(groupMetrics.successPct).toBeCloseTo(99.88, 2)
  })

  it('aggregates group success from throughput when ingest is available', () => {
    const rows = [
      row({
        id: '1',
        name: 'Fast',
        status: 'RUNNING',
        ingestEps: 6,
        events1h: 21_600,
        successRate5m: 99.86,
        deliveryPctKnown: true,
        deliveryPct: 99.86,
      }),
      row({
        id: '2',
        name: 'Slow',
        status: 'RUNNING',
        ingestEps: 0,
        events1h: 0,
        successRate5m: 95.8,
        deliveryPctKnown: true,
        deliveryPct: 95.8,
      }),
    ]
    const groupMetrics = aggregateGroupRates(rows)
    expect(groupMetrics.ingestLabel).toBe('6 events/sec')
    expect(groupMetrics.successPct).toBeCloseTo(99.86, 2)
    expect(groupMetrics.successLabel).toBe('99.86%')
  })
})
