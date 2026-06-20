import { describe, expect, it } from 'vitest'
import type { StreamConsoleRow } from '../api/streamRows'
import {
  buildProblemStreamItems,
  compareGroupsProblemFirst,
  compareStreamsProblemFirst,
  computeStreamOperationsSummary,
  filterStreamRows,
  sortGroupsProblemFirst,
  sortStreamsProblemFirst,
  streamMatchesSearch,
} from './streams-console-operations'

function row(partial: Partial<StreamConsoleRow> & Pick<StreamConsoleRow, 'id' | 'name' | 'status'>): StreamConsoleRow {
  return {
    connectorName: 'Office365 Connector',
    connectorProductGroup: 'Office365',
    sourceTypeLabel: 'API',
    runtimeStatsAttempted: true,
    hasRuntimeApiSnapshot: true,
    events1h: 100,
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

describe('streams-console-operations', () => {
  const healthy = row({ id: '1', name: 'Alpha', status: 'RUNNING' })
  const warning = row({ id: '2', name: 'Beta', status: 'DEGRADED', routesDegraded: 1 })
  const critical = row({ id: '3', name: 'Gamma', status: 'ERROR', routesError: 2 })
  const allRows = [healthy, warning, critical]

  it('sorts streams problem-first by severity, issue count, then name', () => {
    const shuffled = [healthy, critical, warning]
    expect(sortStreamsProblemFirst(shuffled).map((r) => r.id)).toEqual(['3', '2', '1'])
    expect(compareStreamsProblemFirst(critical, warning)).toBeLessThan(0)
  })

  it('filters by quick filter issues only', () => {
    const out = filterStreamRows({
      rows: allRows,
      searchQuery: '',
      quickFilter: 'issues',
      groupFilter: 'all',
      destinationLabelsByStreamId: new Map(),
    })
    expect(out.map((r) => r.id)).toEqual(['3', '2'])
  })

  it('filters by search across name, product, and destination labels', () => {
    const destMap = new Map<number, string[]>([[2, ['Splunk Prod']]])
    expect(streamMatchesSearch(warning, 'splunk', destMap.get(2)!)).toBe(true)
    expect(streamMatchesSearch(healthy, 'office365', [])).toBe(true)
    const out = filterStreamRows({
      rows: allRows,
      searchQuery: 'gamma',
      quickFilter: 'all',
      groupFilter: 'all',
      destinationLabelsByStreamId: destMap,
    })
    expect(out.map((r) => r.id)).toEqual(['3'])
  })

  it('filters by source product group', () => {
    const aws = row({
      id: '4',
      name: 'CloudTrail',
      status: 'RUNNING',
      connectorName: 'AWS',
      connectorProductGroup: 'Amazon Web Services',
    })
    const out = filterStreamRows({
      rows: [...allRows, aws],
      searchQuery: '',
      quickFilter: 'all',
      groupFilter: 'Office365',
      destinationLabelsByStreamId: new Map(),
    })
    expect(out.every((r) => r.connectorProductGroup === 'Office365')).toBe(true)
  })

  it('computes stream operations summary', () => {
    expect(computeStreamOperationsSummary(allRows)).toEqual({
      healthy: 1,
      warning: 1,
      critical: 1,
      issues: 2,
    })
  })

  it('builds problem stream items for warning and critical only', () => {
    const items = buildProblemStreamItems(allRows)
    expect(items.map((i) => i.row.id)).toEqual(['3', '2'])
    expect(items[0]?.severity).toBe('critical')
  })

  it('sorts groups problem-first', () => {
    const groups = sortGroupsProblemFirst([
      { productLabel: 'HealthyCo', rows: [healthy], worstStatus: 'RUNNING', issueCount: 0 },
      { productLabel: 'BadCo', rows: [critical], worstStatus: 'ERROR', issueCount: 1 },
      { productLabel: 'WarnCo', rows: [warning], worstStatus: 'DEGRADED', issueCount: 1 },
    ])
    expect(groups.map((g) => g.productLabel)).toEqual(['BadCo', 'WarnCo', 'HealthyCo'])
    expect(compareGroupsProblemFirst(groups[0]!, groups[1]!)).toBeLessThan(0)
  })
})
