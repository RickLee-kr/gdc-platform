/**
 * Demo connector operational overview payloads. Replace with API hooks when endpoints exist.
 */

import type { StreamRuntimeStatus } from '../../api/streamRows'

export type ConnectorOverviewTab = 'overview' | 'streams' | 'routes' | 'events' | 'logs' | 'settings'

export type ConnectorHealthSlice = {
  key: string
  label: string
  value: number
  color: string
}

export type FailingStreamRow = {
  streamId: string
  name: string
  status: StreamRuntimeStatus
  lastError: string
  since: string
}

export type RecentActivityRow = {
  time: string
  type: 'RUN' | 'DELIVERY' | 'ERROR' | 'WARN'
  message: string
  streamName: string
  ok: boolean
}

export type ConnectorStreamTableRow = {
  streamId: string
  name: string
  sourcePath: string
  pollingIntervalSec: number
  status: StreamRuntimeStatus
  events1h: number
  eventsTrend: readonly number[]
  deliveryPct: number
  lastRunRelative: string
  lastCheckpointDisplay: string
  checkpointLagLabel: string
}

export type ConnectorDetailMock = {
  connectorId: string
  name: string
  status: StreamRuntimeStatus
  productLabel: string
  connectorTypeLabel: string
  sourceTypeLabel: string
  createdDisplay: string
  createdBy: string
  lastUpdatedRelative: string
  statusSinceDisplay: string
  streamsTotal: number
  streamsRunning: number
  streamsIssueCount: number
  streamsTrend: readonly number[]
  events1h: number
  eventsPerMinApprox: number
  eventsTrend: readonly number[]
  deliveryPct: number
  deliveryLabel: string
  deliveryTrend: readonly number[]
  errorRatePct: number
  errorRatePerMinLabel: string
  errorTrend: readonly number[]
  destinationsTotal: number
  destinationsHealthy: number
  destinationsIssueCount: number
  streamsHealthSlices: readonly ConnectorHealthSlice[]
  topFailingStreams: readonly FailingStreamRow[]
  connectorIdDisplay: string
  baseUrl: string
  authType: string
  rateLimitLabel: string
  timeoutSec: number
  createdAt: string
  updatedAt: string
  tags: readonly string[]
  recentActivity: readonly RecentActivityRow[]
  eventsOverTime: readonly {
    bucket: string
    ingested: number
    mapped: number
    delivered: number
    failed: number
  }[]
  healthSummary: {
    sourceConnectivity: 'ok' | 'warn' | 'error'
    authentication: 'ok' | 'warn' | 'error'
    rateLimit: 'ok' | 'warn' | 'error'
    avgLatencyMs: number
    latencyTrend: readonly number[]
    errorRate1hPct: number
    consecutiveFailures: number
    backoffState: string
  }
  streamsTable: readonly ConnectorStreamTableRow[]
}

const CYBEREASON_TABLE: readonly ConnectorStreamTableRow[] = [
  {
    streamId: 'malop-api',
    name: 'Malop API',
    sourcePath: '/api/v2/malops',
    pollingIntervalSec: 60,
    status: 'RUNNING',
    events1h: 12_340,
    eventsTrend: [8200, 9100, 8800, 10_200, 11_400, 12_100, 12_340],
    deliveryPct: 99.62,
    lastRunRelative: '2s ago',
    lastCheckpointDisplay: '2026-05-08 10:02:14',
    checkpointLagLabel: '2m behind',
  },
  {
    streamId: 'hunting-api',
    name: 'Hunting API',
    sourcePath: '/api/v1/hunting/query',
    pollingIntervalSec: 120,
    status: 'DEGRADED',
    events1h: 4120,
    eventsTrend: [5200, 4800, 4500, 4200, 4100, 4050, 4120],
    deliveryPct: 97.2,
    lastRunRelative: '12s ago',
    lastCheckpointDisplay: '2026-05-08 09:48:02',
    checkpointLagLabel: '16m behind',
  },
  {
    streamId: 'sensor-inventory',
    name: 'Sensor inventory',
    sourcePath: '/api/v1/sensors',
    pollingIntervalSec: 300,
    status: 'RUNNING',
    events1h: 890,
    eventsTrend: [700, 720, 750, 780, 800, 860, 890],
    deliveryPct: 100,
    lastRunRelative: '5s ago',
    lastCheckpointDisplay: '2026-05-08 10:03:58',
    checkpointLagLabel: 'On schedule',
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    streamId: `cybereason-extra-${i + 1}`,
    name: ['User API', 'Threat Intel', 'Remediation', 'Campaign API', 'Isolation', 'Policies', 'Artifacts', 'DNS Activity', 'Endpoint IOC'][i] ?? `Stream ${i + 1}`,
    sourcePath: `/api/v1/stream-${i + 1}`,
    pollingIntervalSec: [120, 300, 60, 180, 240, 600, 90, 120, 300][i] ?? 120,
    status: (i === 2 ? 'ERROR' : 'RUNNING') as StreamRuntimeStatus,
    events1h: [2100, 980, 12, 440, 1200, 3400, 890, 2100, 450][i] ?? 500,
    eventsTrend: [800, 850, 900, 920, 940, 960, 980, 1000].map((x) => x + i * 40),
    deliveryPct: i === 2 ? 62.4 : 99.2 + i * 0.01,
    lastRunRelative: `${(i % 5) + 1}s ago`,
    lastCheckpointDisplay: '2026-05-08 09:58:00',
    checkpointLagLabel: i === 2 ? 'Stalled' : '3m behind',
  })),
]

function cybereasonDetail(): ConnectorDetailMock {
  return {
    connectorId: 'cybereason',
    name: 'Cybereason',
    status: 'RUNNING',
    productLabel: 'EDR Platform',
    connectorTypeLabel: 'HTTP API Polling',
    sourceTypeLabel: 'HTTP API Polling',
    createdDisplay: '2024-04-15 10:22:11',
    createdBy: 'operator@gdc.local',
    lastUpdatedRelative: '5s ago',
    statusSinceDisplay: '2024-05-08 09:15:22',
    streamsTotal: 12,
    streamsRunning: 10,
    streamsIssueCount: 2,
    streamsTrend: [9, 10, 10, 11, 11, 12, 12],
    events1h: 124_320,
    eventsPerMinApprox: 2072,
    eventsTrend: [110_000, 112_000, 118_000, 119_000, 121_000, 123_000, 124_320],
    deliveryPct: 99.62,
    deliveryLabel: 'Successfully delivered',
    deliveryTrend: [99.1, 99.3, 99.4, 99.5, 99.55, 99.6, 99.62],
    errorRatePct: 0.38,
    errorRatePerMinLabel: '~ 8.0 / min',
    errorTrend: [0.9, 0.7, 0.6, 0.55, 0.45, 0.4, 0.38],
    destinationsTotal: 8,
    destinationsHealthy: 5,
    destinationsIssueCount: 3,
    streamsHealthSlices: [
      { key: 'running', label: 'Running', value: 10, color: '#22c55e' },
      { key: 'degraded', label: 'Degraded', value: 1, color: '#f59e0b' },
      { key: 'error', label: 'Error', value: 1, color: '#ef4444' },
      { key: 'stopped', label: 'Stopped', value: 0, color: '#94a3b8' },
    ],
    topFailingStreams: [
      {
        streamId: 'cybereason-extra-3',
        name: 'Remediation',
        status: 'ERROR',
        lastError: 'HTTP 500 Internal Server Error',
        since: '18m ago',
      },
      {
        streamId: 'hunting-api',
        name: 'Hunting API',
        status: 'DEGRADED',
        lastError: 'Partial fan-out: backup route 429 backoff',
        since: '2m ago',
      },
      {
        streamId: 'malop-api',
        name: 'Malop API',
        status: 'RUNNING',
        lastError: 'Route to SIEM Webhook failed (timeout, retrying)',
        since: '6m ago',
      },
    ],
    connectorIdDisplay: 'conn-cybereason-prod',
    baseUrl: 'https://tenant.cybereason.net',
    authType: 'API Key',
    rateLimitLabel: '100 req/min',
    timeoutSec: 30,
    createdAt: '2024-04-15 10:22:11',
    updatedAt: '2026-05-08 09:14:02',
    tags: ['cybereason', 'edr', 'security'],
    recentActivity: [
      { time: '10:03:41', type: 'DELIVERY', message: 'Delivered batch #88421 to SIEM · primary route OK', streamName: 'Malop API', ok: true },
      { time: '10:03:38', type: 'RUN', message: 'Poll completed · 512 events extracted', streamName: 'Sensor inventory', ok: true },
      { time: '10:03:22', type: 'ERROR', message: 'route_send_failed · connection reset', streamName: 'Remediation', ok: false },
      { time: '10:02:58', type: 'RUN', message: 'Checkpoint advanced after successful delivery', streamName: 'Sensor inventory', ok: true },
      { time: '10:02:44', type: 'WARN', message: 'destination_rate_limited · webhook EPS cap', streamName: 'Malop API', ok: false },
    ],
    eventsOverTime: [
      { bucket: ':00', ingested: 18_200, mapped: 17_900, delivered: 17_850, failed: 42 },
      { bucket: ':10', ingested: 19_400, mapped: 19_100, delivered: 19_020, failed: 55 },
      { bucket: ':20', ingested: 20_100, mapped: 19_800, delivered: 19_720, failed: 48 },
      { bucket: ':30', ingested: 21_000, mapped: 20_700, delivered: 20_620, failed: 62 },
      { bucket: ':40', ingested: 20_400, mapped: 20_050, delivered: 19_980, failed: 38 },
      { bucket: ':50', ingested: 21_200, mapped: 20_900, delivered: 20_820, failed: 51 },
    ],
    healthSummary: {
      sourceConnectivity: 'ok',
      authentication: 'ok',
      rateLimit: 'warn',
      avgLatencyMs: 182,
      latencyTrend: [165, 170, 172, 175, 178, 180, 182],
      errorRate1hPct: 0.38,
      consecutiveFailures: 2,
      backoffState: 'Idle',
    },
    streamsTable: CYBEREASON_TABLE,
  }
}

function genericFallback(id: string): ConnectorDetailMock {
  const base = cybereasonDetail()
  return {
    ...base,
    connectorId: id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    connectorIdDisplay: `conn-${id}`,
    streamsTable: base.streamsTable.slice(0, 5),
    streamsTotal: 5,
    streamsRunning: 4,
    streamsIssueCount: 1,
    streamsHealthSlices: [
      { key: 'running', label: 'Running', value: 4, color: '#22c55e' },
      { key: 'degraded', label: 'Degraded', value: 1, color: '#f59e0b' },
      { key: 'error', label: 'Error', value: 0, color: '#ef4444' },
      { key: 'stopped', label: 'Stopped', value: 0, color: '#94a3b8' },
    ],
  }
}

export function getConnectorDetailMock(connectorId: string): ConnectorDetailMock {
  if (connectorId === 'cybereason') return cybereasonDetail()
  return genericFallback(connectorId)
}
