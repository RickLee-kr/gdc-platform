import { describe, expect, it } from 'vitest'
import type { StreamConsoleRow } from '../api/streamRows'
import { applyStreamsConsoleSort, compareStreamRowsByColumn } from './streams-console-sort'
import { groupRowsBySourceProduct } from './source-product-group'

function row(partial: Partial<StreamConsoleRow> & Pick<StreamConsoleRow, 'id' | 'name' | 'status'>): StreamConsoleRow {
  return {
    connectorId: 10,
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
    lastActivityRelative: '2026-07-01T10:00:00Z',
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
    checkpointUpdatedAt: '2026-07-01T09:00:00Z',
    checkpointLagLabel: '—',
    recentErrors: [],
    ...partial,
  }
}

describe('streams-console-sort', () => {
  it('sorts streams by name ascending', () => {
    const alpha = row({ id: '1', name: 'Alpha', status: 'RUNNING' })
    const zulu = row({ id: '2', name: 'Zulu', status: 'RUNNING' })
    expect(compareStreamRowsByColumn(alpha, zulu, 'stream', 'asc', '1h', new Map())).toBeLessThan(0)
    expect(compareStreamRowsByColumn(zulu, alpha, 'stream', 'asc', '1h', new Map())).toBeGreaterThan(0)
  })

  it('sorts streams by EPS descending', () => {
    const low = row({ id: '1', name: 'Low', status: 'RUNNING', eps5m: 1 })
    const high = row({ id: '2', name: 'High', status: 'RUNNING', eps5m: 10 })
    expect(compareStreamRowsByColumn(high, low, 'eps', 'desc', '1h', new Map())).toBeLessThan(0)
  })

  it('sorts product groups and child rows together', () => {
    const rows = [
      row({ id: '1', name: 'b-stream', status: 'RUNNING', connectorProductGroup: 'Group B', connectorName: 'b' }),
      row({ id: '2', name: 'a-stream', status: 'RUNNING', connectorProductGroup: 'Group A', connectorName: 'a' }),
    ]
    const sorted = applyStreamsConsoleSort({
      groups: groupRowsBySourceProduct(rows),
      column: 'stream',
      direction: 'asc',
      metricsWindow: '1h',
      destinationLabelsByStreamId: new Map(),
    })
    expect(sorted.map((g) => g.productLabel)).toEqual(['a', 'Group B'])
    expect(sorted[1]?.rows.map((r) => r.name)).toEqual(['b-stream'])
  })
})
