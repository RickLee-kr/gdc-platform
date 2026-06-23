import { describe, expect, it } from 'vitest'
import type { StreamConsoleRow } from '../api/streamRows'
import {
  aggregateGroupIssueCauses,
  deriveStreamIssueCauses,
  formatIssuesDisplay,
  formatStreamIssuesCell,
  sortIssueCausesByPriority,
  streamOperationalHealthLabel,
} from './stream-console-issue-causes'
import { effectiveStreamSeverity } from './stream-operational-status'

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

describe('stream-console-issue-causes', () => {
  it('reports No Data when runtime snapshot is missing', () => {
    const causes = deriveStreamIssueCauses(
      row({ id: '1', name: 'A', status: 'RUNNING', hasRuntimeApiSnapshot: false, runtimeStatsAttempted: true }),
      '15m',
    )
    expect(causes).toContain('No Data (15m)')
  })

  it('reports Destination Error for ERROR status', () => {
    const causes = deriveStreamIssueCauses(row({ id: '2', name: 'B', status: 'ERROR', routesError: 1 }), '1h')
    expect(causes).toContain('Destination Error')
    expect(causes).not.toContain('No Data (1h)')
  })

  it('does not report destination issues for idle routes with strong success rate', () => {
    const causes = deriveStreamIssueCauses(
      row({
        id: '6',
        name: 'CyberHeaven',
        status: 'RUNNING',
        routesTotal: 2,
        routesOk: 0,
        routesDegraded: 2,
        routesError: 0,
        deliveryPct: 100,
        deliveryPctKnown: true,
        runtimeIssue: 'Stream delivery degraded',
      }),
      '1h',
    )
    expect(causes).not.toContain('Destination Error')
    expect(causes).not.toContain('Stream delivery degraded')
    expect(formatStreamIssuesCell(
      row({
        id: '6',
        name: 'CyberHeaven',
        status: 'RUNNING',
        routesTotal: 2,
        routesOk: 0,
        routesDegraded: 2,
        routesError: 0,
        deliveryPct: 100,
        deliveryPctKnown: true,
        runtimeIssue: 'Stream delivery degraded',
      }),
      '1h',
    )).toBe('—')
  })

  it('reports Checkpoint Error from recent delivery logs', () => {
    const causes = deriveStreamIssueCauses(
      row({
        id: '3',
        name: 'C',
        status: 'DEGRADED',
        recentErrors: [{ message: 'checkpoint_update failed', relativeAt: '1m ago' }],
      }),
      '1h',
    )
    expect(causes).toContain('Checkpoint Error')
  })

  it('sorts causes by operator priority (Protection before Destination)', () => {
    const sorted = sortIssueCausesByPriority([
      'Schema Drift',
      'Destination Error',
      'Protection Block',
      'No Data (1h)',
    ])
    expect(sorted).toEqual(['Protection Block', 'Destination Error', 'No Data (1h)', 'Schema Drift'])
  })

  it('limits issues display to two causes with +N suffix', () => {
    expect(
      formatIssuesDisplay([
        'Schema Drift',
        'Destination Error',
        'Protection Block',
        'No Data (1h)',
      ]),
    ).toBe('Protection Block · Destination Error +2')
  })

  it('aggregates unique group causes with limited label', () => {
    const a = row({ id: '1', name: 'A', status: 'ERROR', routesError: 1 })
    const b = row({
      id: '2',
      name: 'B',
      status: 'DEGRADED',
      recentErrors: [{ message: 'schema drift detected', relativeAt: '1m ago' }],
    })
    const agg = aggregateGroupIssueCauses([a, b], '24h')
    expect(agg.streamCount).toBe(2)
    expect(agg.label).toMatch(/Destination Error/)
    expect(agg.hiddenCount).toBeGreaterThanOrEqual(0)
  })

  it('formats stream issues cell with cause labels', () => {
    expect(formatStreamIssuesCell(row({ id: '4', name: 'D', status: 'RUNNING' }), '1h')).toBe('—')
    expect(
      formatStreamIssuesCell(row({ id: '5', name: 'E', status: 'ERROR', routesError: 2 }), '1h'),
    ).toBe('Destination Error')
  })

  it('maps operational health labels from severity', () => {
    expect(streamOperationalHealthLabel(effectiveStreamSeverity(row({ id: '6', name: 'F', status: 'RUNNING' })))).toBe(
      'Healthy',
    )
    expect(streamOperationalHealthLabel(effectiveStreamSeverity(row({ id: '7', name: 'G', status: 'DEGRADED', deliveryPct: 80, deliveryPctKnown: true })))).toBe(
      'Warning',
    )
  })
})
