/** Static demo dataset for the Logs explorer — replace with API responses later. */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'

/** UI timeline nodes (observability mock — aligns conceptually with runtime stages). */
export type PipelineTimelineKey = 'POLLING' | 'SOURCE' | 'PARSING' | 'MAPPING' | 'DELIVERY' | 'CHECKPOINT'

export type TimelineNodeStatus = 'complete' | 'failed' | 'pending'

export type MockLogRow = {
  id: string
  /** evt_… legacy id — prefer requestId for API compatibility */
  eventId: string
  /** correlates related log lines (future: delivery_logs.request_correlation) */
  requestId?: string
  /** ISO timestamp */
  timeIso: string
  level: LogLevel
  connector: string
  stream: string
  /** e.g. Malop API → Stellar SIEM */
  route: string
  /** Display pipeline stage for table column — falls back to derived label from contextJson.stage */
  pipelineStage?: string
  message: string
  durationMs: number
  worker?: string
  host?: string
  /** First-event preview JSON for drawer */
  eventPreview?: Record<string, unknown>
  /** Structured context aligned with delivery/runtime logs (stage, route_send_*, etc.) */
  contextJson: Record<string, unknown>
  relatedEventId: string | null
}

export const LOGS_KPI = {
  total: 12_458,
  totalDeltaPct: 12.5,
  errors: 156,
  errorsDeltaPct: 8.3,
  warnings: 342,
  warningsDeltaPct: 5.7,
  info: 11_960,
  infoDeltaPct: 14.1,
  /** remainder used only for charts */
  debugApprox: 0,
} as const

/** URL slug → stream filter label (breadcrumb shows "{Name}" stream title). */
export const LOG_STREAM_SLUG_LABEL: Record<string, string> = {
  'malop-api': 'Malop API Stream',
  'malop-api-stream': 'Malop API Stream',
  hunting: 'Hunting API Stream',
  sensor: 'Sensor API Stream',
}

/** Stacked volumes by log level per time bucket (1h window, demo). */
export const LOGS_OVER_TIME = [
  { bucket: '09:05', error: 12, warn: 38, info: 920, debug: 14 },
  { bucket: '09:15', error: 18, warn: 44, info: 980, debug: 18 },
  { bucket: '09:25', error: 15, warn: 41, info: 1010, debug: 16 },
  { bucket: '09:35', error: 22, warn: 52, info: 1050, debug: 20 },
  { bucket: '09:45', error: 14, warn: 48, info: 990, debug: 15 },
  { bucket: '09:55', error: 19, warn: 46, info: 1020, debug: 17 },
  { bucket: '10:05', error: 16, warn: 43, info: 980, debug: 15 },
] as const

export const LOG_LEVEL_DONUT = [
  { key: 'error', label: 'Error', value: 186, color: '#ef4444' },
  { key: 'warn', label: 'Warn', value: 542, color: '#f59e0b' },
  { key: 'info', label: 'Info', value: 11_730, color: '#3b82f6' },
] as const

export const TOP_LOG_SOURCES = [
  { name: 'Malop API', count: 4521, pct: 36.3 },
  { name: 'Hunting API', count: 3188, pct: 25.6 },
  { name: 'Sensor API', count: 2104, pct: 16.9 },
  { name: 'Detections', count: 1542, pct: 12.4 },
  { name: 'Audit Log', count: 1103, pct: 8.9 },
] as const

export const TIME_RANGE_OPTIONS = ['Last 15 minutes', 'Last 1 hour', 'Last 6 hours', 'Last 24 hours'] as const

export const DISPLAY_RANGE_LABEL = '2026-05-08 09:05 → 2026-05-08 10:05'

export const CONNECTOR_FILTER_OPTIONS = ['All Connectors', 'Cybereason', 'CrowdStrike', 'Palo Alto', 'Custom API'] as const

export const STREAM_FILTER_OPTIONS = [
  'All Streams',
  'Malop API',
  'Hunting API',
  'Sensor API',
  'Detections',
  'Audit Log',
  'Custom Stream',
] as const

export const ROUTE_FILTER_OPTIONS = [
  'All Routes',
  'Malop API → Stellar SIEM',
  'Malop API → SIEM Webhook',
  'Hunting API → Stellar SIEM',
  'Hunting API → SIEM Webhook',
  'Detections → Splunk HEC',
  'Sensor API → Stellar SIEM',
  'Sensor API → Backup Syslog',
  'Audit Log → SIEM Webhook',
  'Audit Log → Backup Syslog',
  'Custom feed → Elastic Webhook',
] as const

export const LEVEL_FILTER_OPTIONS = ['All Levels', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const

export const PIPELINE_STAGE_FILTER_OPTIONS = [
  'All Stages',
  'POLLING',
  'SOURCE',
  'PARSING',
  'MAPPING',
  'DELIVERY',
  'RETRY',
  'CHECKPOINT',
] as const

/** Backend-ish stage keys persisted in logs — maps to UI pipeline column + timeline. */
export type BackendLogStage =
  | 'source_fetch'
  | 'source_rate_limit'
  | 'parse'
  | 'mapping'
  | 'enrichment'
  | 'format'
  | 'route'
  | 'syslog_send'
  | 'webhook_send'
  | 'checkpoint_update'
  | 'run_complete'
  | 'destination_rate_limited'
  | 'route_retry_failed'
  | 'route_retry_success'
  | string

export function getRequestId(row: MockLogRow): string {
  const fromRun = typeof row.contextJson.run_id === 'string' && row.contextJson.run_id.trim() !== '' ? row.contextJson.run_id : null
  return fromRun ?? row.requestId ?? row.eventId.replace(/^evt_/, 'req_')
}

export function getWorker(row: MockLogRow): string {
  return row.worker ?? 'worker-02'
}

export function getHost(row: MockLogRow): string {
  return row.host ?? 'gdc-connector-01'
}

export function getEventPreview(row: MockLogRow): Record<string, unknown> {
  if (row.eventPreview) return row.eventPreview
  const sample = row.contextJson.payload_sample
  if (sample && typeof sample === 'object' && !Array.isArray(sample)) return sample as Record<string, unknown>
  return {
    event_id: 'malop-8821',
    severity: 'high',
    stream: row.stream,
    route: row.route,
    stage: row.contextJson.stage,
  }
}

/** Maps persisted stage strings (source_fetch, mapping, syslog_send, …) to compact UI labels. */
export function pipelineStageLabel(row: MockLogRow): string {
  if (row.pipelineStage) return row.pipelineStage
  const st = String(row.contextJson.stage ?? '').toLowerCase() as BackendLogStage
  if (!st) return '—'
  if (st.includes('retry')) return 'RETRY'
  if (st === 'source_fetch' || st === 'source_rate_limit') return 'SOURCE'
  if (st === 'parse') return 'PARSING'
  if (st === 'mapping' || st === 'enrichment') return 'MAPPING'
  if (st === 'format' || st === 'route') return 'DELIVERY'
  if (st === 'syslog_send' || st === 'webhook_send' || st === 'destination_rate_limited') return 'DELIVERY'
  if (st === 'run_started' || st === 'checkpoint_update' || st === 'run_complete') return 'CHECKPOINT'
  return st.replace(/_/g, ' ').toUpperCase()
}

function timelineIndexFromBackendStage(stage: string): number {
  const s = stage.toLowerCase()
  if (s === 'source_fetch' || s === 'source_rate_limit') return 1
  if (s === 'parse') return 2
  if (s === 'mapping' || s === 'enrichment') return 3
  if (s === 'format' || s === 'route') return 4
  if (
    s === 'syslog_send' ||
    s === 'webhook_send' ||
    s === 'destination_rate_limited' ||
    s.includes('retry')
  )
    return 4
  if (s === 'checkpoint_update' || s === 'run_complete') return 5
  return 4
}

const TIMELINE_KEYS: readonly PipelineTimelineKey[] = [
  'POLLING',
  'SOURCE',
  'PARSING',
  'MAPPING',
  'DELIVERY',
  'CHECKPOINT',
] as const

export function buildPipelineTimeline(row: MockLogRow): Array<{ key: PipelineTimelineKey; status: TimelineNodeStatus }> {
  const stage = String(row.contextJson.stage ?? '').toLowerCase()
  let failIdx: number | null = null
  if (row.level === 'ERROR') {
    if (stage === 'parse') failIdx = 2
    else if (stage === 'mapping' || stage === 'enrichment') failIdx = 3
    else if (stage === 'checkpoint_update') failIdx = 5
    else failIdx = 4
  }

  if (failIdx !== null) {
    return TIMELINE_KEYS.map((key, i) => {
      if (i < failIdx!) return { key, status: 'complete' }
      if (i === failIdx!) return { key, status: 'failed' }
      return { key, status: 'pending' }
    })
  }

  const through = timelineIndexFromBackendStage(stage)
  const allDone = stage === 'run_complete' || stage === 'checkpoint_update'

  return TIMELINE_KEYS.map((key, i) => {
    if (allDone) return { key, status: 'complete' }
    if (i <= through) return { key, status: 'complete' }
    return { key, status: 'pending' }
  })
}

function ctx(
  partial: Record<string, unknown>,
): Record<string, unknown> {
  return partial
}

export const MOCK_LOG_ROWS: MockLogRow[] = [
  {
    id: 'log-001',
    requestId: 'req_01JTXSHARED001ABCDEF',
    eventId: 'evt_01HZZX9K2M4P8Q9R0S1T2U3V',
    timeIso: '2026-05-08T10:04:58.123Z',
    level: 'ERROR',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → Stellar SIEM',
    message: 'Failed to send event to destination',
    durationMs: 532,
    relatedEventId: 'evt_01HZZX8Y1N3O7P8Q9R0S1T2U',
    contextJson: ctx({
      connector_id: 1,
      stream_id: 10,
      route_id: 5,
      destination_id: 3,
      stage: 'webhook_send',
      status: 'route_send_failed',
      retry_count: 2,
      http_status: 500,
      latency_ms: 532,
      error_code: 'DESTINATION_HTTP_ERROR',
      message: 'Failed to send event to destination',
      payload_sample: { event_id: 'malop-8821', severity: 'high' },
    }),
  },
  {
    id: 'log-002',
    requestId: 'req_01JTXSHARED001ABCDEF',
    eventId: 'evt_01HZZX9K3N5Q1R2S3T4U5V6W',
    timeIso: '2026-05-08T10:04:42.881Z',
    level: 'WARN',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → SIEM Webhook',
    message: 'Destination rate limit approaching threshold',
    durationMs: 41,
    relatedEventId: null,
    contextJson: ctx({
      connector_id: 1,
      stream_id: 10,
      route_id: 6,
      destination_id: 4,
      stage: 'destination_rate_limited',
      level: 'WARN',
      status: 'destination_rate_limited',
      retry_count: 0,
      latency_ms: 41,
      error_code: null,
    }),
  },
  {
    id: 'log-003',
    eventId: 'evt_01HZZX9K4O6R2S3T4U5V6W7X',
    timeIso: '2026-05-08T10:04:21.050Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Hunting API',
    route: 'Hunting API → Stellar SIEM',
    message: 'route_send_success',
    durationMs: 28,
    relatedEventId: null,
    contextJson: ctx({
      connector_id: 1,
      stream_id: 11,
      route_id: 8,
      destination_id: 3,
      stage: 'syslog_send',
      status: 'route_send_success',
      retry_count: 0,
      latency_ms: 28,
    }),
  },
  {
    id: 'log-004',
    eventId: 'evt_01HZZX9K5P7S3T4U5V6W7X8Y',
    timeIso: '2026-05-08T10:03:58.600Z',
    level: 'INFO',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'Batch delivered (50 events)',
    durationMs: 120,
    relatedEventId: null,
    contextJson: ctx({
      connector_id: 2,
      stream_id: 40,
      route_id: 22,
      destination_id: 12,
      stage: 'webhook_send',
      status: 'route_send_success',
      retry_count: 0,
      http_status: 200,
      latency_ms: 120,
    }),
  },
  {
    id: 'log-005',
    eventId: 'evt_01HZZX9K6Q8T4U5V6W7X8Y9Z',
    timeIso: '2026-05-08T10:03:12.334Z',
    level: 'DEBUG',
    connector: 'Cybereason',
    stream: 'Sensor API',
    route: 'Sensor API → Backup Syslog',
    message: 'Formatter applied: syslog_rfc5424',
    durationMs: 3,
    relatedEventId: null,
    contextJson: ctx({
      connector_id: 1,
      stream_id: 12,
      route_id: 9,
      stage: 'format',
      level: 'DEBUG',
      latency_ms: 3,
    }),
  },
  {
    id: 'log-006',
    eventId: 'evt_01HZZX9K7R9U5V6W7X8Y9Z0A',
    timeIso: '2026-05-08T10:02:44.201Z',
    level: 'ERROR',
    connector: 'Cybereason',
    stream: 'Sensor API',
    route: 'Sensor API → Stellar SIEM',
    message: 'Connection refused',
    durationMs: 2102,
    relatedEventId: 'evt_01HZZX9K6Q8T4U5V6W7X8Y9Z',
    contextJson: ctx({
      stream_id: 12,
      route_id: 7,
      destination_id: 3,
      stage: 'syslog_send',
      status: 'route_send_failed',
      retry_count: 3,
      latency_ms: 2102,
      error_code: 'DESTINATION_CONNECTION_FAILED',
    }),
  },
  {
    id: 'log-007',
    eventId: 'evt_01HZZX9K8S0V6W7X8Y9Z0A1B',
    timeIso: '2026-05-08T10:02:10.778Z',
    level: 'WARN',
    connector: 'Palo Alto',
    stream: 'Audit Log',
    route: 'Audit Log → SIEM Webhook',
    message: 'Retry scheduled with backoff',
    durationMs: 88,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'route_retry_failed',
      status: 'route_retry_failed',
      retry_count: 1,
      latency_ms: 88,
      http_status: 503,
    }),
  },
  {
    id: 'log-008',
    eventId: 'evt_01HZZX9K9T1W7X8Y9Z0A1B2C',
    timeIso: '2026-05-08T10:01:55.412Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → Stellar SIEM',
    message: 'run_complete',
    durationMs: 412,
    relatedEventId: null,
    contextJson: ctx({
      stream_id: 10,
      stage: 'run_complete',
      status: 'run_complete',
      latency_ms: 412,
    }),
  },
  {
    id: 'log-009',
    eventId: 'evt_01HZZX9L0U2X8Y9Z0A1B2C3D',
    timeIso: '2026-05-08T10:01:22.990Z',
    level: 'INFO',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'Mapping applied: 14 fields',
    durationMs: 12,
    relatedEventId: null,
    contextJson: ctx({ stream_id: 40, stage: 'mapping', level: 'INFO' }),
  },
  {
    id: 'log-010',
    eventId: 'evt_01HZZX9L1V3Y9Z0A1B2C3D4E',
    timeIso: '2026-05-08T10:00:48.155Z',
    level: 'ERROR',
    connector: 'Custom API',
    stream: 'Custom Stream',
    route: 'Custom feed → Elastic Webhook',
    message: 'DNS resolution failure',
    durationMs: 5012,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'webhook_send',
      status: 'route_send_failed',
      error_code: 'DNS_FAILURE',
      latency_ms: 5012,
    }),
  },
  {
    id: 'log-011',
    eventId: 'evt_01HZZX9L2W4Z0A1B2C3D4E5F',
    timeIso: '2026-05-08T10:00:15.003Z',
    level: 'DEBUG',
    connector: 'Cybereason',
    stream: 'Hunting API',
    route: 'Hunting API → Stellar SIEM',
    message: 'Checkpoint evaluated: TIMESTAMP',
    durationMs: 2,
    relatedEventId: null,
    contextJson: ctx({ stage: 'checkpoint_update', level: 'DEBUG' }),
  },
  {
    id: 'log-012',
    eventId: 'evt_01HZZX9L3X5A1B2C3D4E5F6G',
    timeIso: '2026-05-08T09:59:44.701Z',
    level: 'WARN',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → SIEM Webhook',
    message: '429 Too Many Requests — honoring Retry-After',
    durationMs: 95,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'webhook_send',
      status: 'destination_rate_limited',
      http_status: 429,
      retry_count: 0,
    }),
  },
  {
    id: 'log-013',
    eventId: 'evt_01HZZX9L4Y6B2C3D4E5F6G7H',
    timeIso: '2026-05-08T09:59:10.228Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → Stellar SIEM',
    message: 'route_send_success',
    durationMs: 19,
    relatedEventId: null,
    contextJson: ctx({ stage: 'syslog_send', status: 'route_send_success', latency_ms: 19 }),
  },
  {
    id: 'log-014',
    eventId: 'evt_01HZZX9L5Z7C3D4E5F6G7H8I',
    timeIso: '2026-05-08T09:58:33.567Z',
    level: 'INFO',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'Enrichment fields injected',
    durationMs: 7,
    relatedEventId: null,
    contextJson: ctx({ stage: 'enrichment', stream_id: 40 }),
  },
  {
    id: 'log-015',
    eventId: 'evt_01HZZX9M6A8D4E5F6G7H8I9J',
    timeIso: '2026-05-08T09:57:59.001Z',
    level: 'ERROR',
    connector: 'Cybereason',
    stream: 'Sensor API',
    route: 'Sensor API → Stellar SIEM',
    message: 'TLS handshake failed',
    durationMs: 180,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'syslog_send',
      error_code: 'TLS_HANDSHAKE_FAILED',
      latency_ms: 180,
    }),
  },
  {
    id: 'log-016',
    eventId: 'evt_01HZZX9M7B9E5F6G7H8I9J0K',
    timeIso: '2026-05-08T09:57:22.445Z',
    level: 'INFO',
    connector: 'Palo Alto',
    stream: 'Audit Log',
    route: 'Audit Log → SIEM Webhook',
    message: 'route_send_success',
    durationMs: 64,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'webhook_send',
      http_status: 200,
      latency_ms: 64,
    }),
  },
  {
    id: 'log-017',
    eventId: 'evt_01HZZX9M8C0F6G7H8I9J0K1L',
    timeIso: '2026-05-08T09:56:48.812Z',
    level: 'WARN',
    connector: 'Cybereason',
    stream: 'Hunting API',
    route: 'Hunting API → Stellar SIEM',
    message: 'Partial fan-out: 1 route degraded',
    durationMs: 210,
    relatedEventId: null,
    contextJson: ctx({ stage: 'route', level: 'WARN' }),
  },
  {
    id: 'log-018',
    eventId: 'evt_01HZZX9M9D1G7H8I9J0K1L2M',
    timeIso: '2026-05-08T09:56:01.300Z',
    level: 'DEBUG',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'Source fetch completed: 200 OK',
    durationMs: 142,
    relatedEventId: null,
    contextJson: ctx({ stage: 'source_fetch', level: 'DEBUG' }),
  },
  {
    id: 'log-019',
    eventId: 'evt_01HZZX9N0E2H8I9J0K1L2M3N',
    timeIso: '2026-05-08T09:55:27.667Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → SIEM Webhook',
    message: 'route_retry_success',
    durationMs: 76,
    relatedEventId: 'evt_01HZZX9L2W4Z0A1B2C3D4E5F',
    contextJson: ctx({
      stage: 'webhook_send',
      status: 'route_retry_success',
      retry_count: 2,
      latency_ms: 76,
    }),
  },
  {
    id: 'log-020',
    eventId: 'evt_01HZZX9N1F3I9J0K1L2M3N4O',
    timeIso: '2026-05-08T09:54:52.144Z',
    level: 'ERROR',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'Read timed out',
    durationMs: 30000,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'webhook_send',
      status: 'route_send_failed',
      error_code: 'HTTP_TIMEOUT',
      latency_ms: 30000,
    }),
  },
  {
    id: 'log-021',
    eventId: 'evt_01HZZX9N2G4J0K1L2M3N4O5P',
    timeIso: '2026-05-08T09:54:18.521Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Malop API',
    route: 'Malop API → Stellar SIEM',
    message: 'Event extracted: array path $.data.items',
    durationMs: 5,
    relatedEventId: null,
    contextJson: ctx({ stage: 'parse', stream_id: 10 }),
  },
  {
    id: 'log-022',
    eventId: 'evt_01HZZX9N3H5K1L2M3N4O5P6Q',
    timeIso: '2026-05-08T09:53:40.009Z',
    level: 'WARN',
    connector: 'Palo Alto',
    stream: 'Audit Log',
    route: 'Audit Log → Backup Syslog',
    message: 'UDP packet dropped (checksum)',
    durationMs: 1,
    relatedEventId: null,
    contextJson: ctx({ stage: 'syslog_send', level: 'WARN' }),
  },
  {
    id: 'log-023',
    eventId: 'evt_01HZZX9N4I6L2M3N4O5P6Q7R',
    timeIso: '2026-05-08T09:53:05.888Z',
    level: 'INFO',
    connector: 'Cybereason',
    stream: 'Hunting API',
    route: 'Hunting API → SIEM Webhook',
    message: 'route_send_success',
    durationMs: 54,
    relatedEventId: null,
    contextJson: ctx({
      stage: 'webhook_send',
      http_status: 200,
      latency_ms: 54,
    }),
  },
  {
    id: 'log-024',
    eventId: 'evt_01HZZX9N5J7M3N4O5P6Q7R8S',
    timeIso: '2026-05-08T09:52:31.222Z',
    level: 'DEBUG',
    connector: 'Cybereason',
    stream: 'Sensor API',
    route: 'Sensor API → Backup Syslog',
    message: 'Rate limit token refill',
    durationMs: 0,
    relatedEventId: null,
    contextJson: ctx({ stage: 'destination_rate_limited', level: 'DEBUG' }),
  },
  {
    id: 'log-025',
    eventId: 'evt_01HZZX9N6K8N4O5P6Q7R8S9T',
    timeIso: '2026-05-08T09:51:58.777Z',
    level: 'INFO',
    connector: 'CrowdStrike',
    stream: 'Detections',
    route: 'Detections → Splunk HEC',
    message: 'run_complete',
    durationMs: 388,
    relatedEventId: null,
    contextJson: ctx({ stage: 'run_complete', stream_id: 40 }),
  },
]
