import { prettyJson } from '../jsonUtils'
import type { PersistedIds } from './runtimeState'

export type DemoScenarioPreset = {
  key: string
  name: string
  sourceType: string
  destinationTopology: string
  explanation: string
  ids: PersistedIds
  connectorSave: string
  sourceSave: string
  streamSave: string
  mappingRawSample: string
  mappingRows: Array<{ outputField: string; sourcePath: string; sampleValue: unknown }>
  mappingEventArrayPath: string
  mappingEnrichment: string
  routeSave: string
  routeConfig: string
  destinationSave: string
  destinationConfig: string
  streamControlResult: Record<string, unknown>
  dashboardData: Record<string, unknown>
  healthData: Record<string, unknown>
  statsData: Record<string, unknown>
  timelineData: Record<string, unknown>
  logSearchData: Record<string, unknown>
  logPageData: Record<string, unknown>
  trendData: Record<string, unknown>
}

const COMMON_TIMELINE_ITEMS = [
  {
    id: 1,
    stage: 'route_send_success',
    level: 'INFO',
    status: 'SUCCESS',
    message: 'Primary route delivery succeeded.',
    created_at: '2026-05-07T12:00:00Z',
    stream_id: 100,
    route_id: 200,
    destination_id: 300,
    payload_sample: { msg: 'ok' },
  },
  {
    id: 2,
    stage: 'route_retry_success',
    level: 'INFO',
    status: 'SUCCESS',
    message: 'Retry delivery recovered after transient failure.',
    created_at: '2026-05-07T12:00:30Z',
    stream_id: 100,
    route_id: 200,
    destination_id: 300,
    payload_sample: { retry: 1 },
  },
  {
    id: 3,
    stage: 'source_rate_limited',
    level: 'WARN',
    status: 'RATE_LIMITED',
    message: 'Source polling limit reached; delaying next fetch.',
    created_at: '2026-05-07T12:01:00Z',
    stream_id: 100,
    route_id: 200,
    destination_id: 300,
  },
  {
    id: 4,
    stage: 'route_send_failed',
    level: 'ERROR',
    status: 'FAILED',
    message: 'Destination temporarily unavailable.',
    created_at: '2026-05-07T12:01:30Z',
    stream_id: 100,
    route_id: 200,
    destination_id: 300,
    error_code: 'DEMO_DEST_TEMP_DOWN',
  },
  {
    id: 5,
    stage: 'checkpoint_update',
    level: 'INFO',
    status: 'SUCCESS',
    message: 'Checkpoint advanced after successful delivery window.',
    created_at: '2026-05-07T12:02:00Z',
    stream_id: 100,
    route_id: 200,
    destination_id: 300,
    payload_sample: { checkpoint: { type: 'OFFSET', value: { last_id: 'evt-5' } } },
  },
]

function withIds(
  items: Array<Record<string, unknown>>,
  ids: { stream_id: number; route_id: number; destination_id: number },
): Array<Record<string, unknown>> {
  return items.map((item, idx) => ({
    ...item,
    id: Number(item.id ?? idx + 1),
    stream_id: ids.stream_id,
    route_id: ids.route_id,
    destination_id: ids.destination_id,
  }))
}

function buildCommonObservabilitySeed(name: string, ids: { streamId: number; routeId: number; destinationId: number }) {
  const timelineItems = withIds(COMMON_TIMELINE_ITEMS, {
    stream_id: ids.streamId,
    route_id: ids.routeId,
    destination_id: ids.destinationId,
  })
  return {
    streamControlResult: {
      stream_id: ids.streamId,
      enabled: true,
      status: 'RUNNING',
      action: 'demo_seed_loaded',
      message: `${name} demo scenario loaded (frontend local simulation).`,
    },
    dashboardData: {
      summary: {
        total_streams: 1,
        running_streams: 1,
        recent_failures: 1,
        recent_rate_limited: 1,
      },
      recent_problem_routes: [timelineItems[3]],
      recent_rate_limited_routes: [timelineItems[2]],
      recent_unhealthy_streams: [{ stream_id: ids.streamId, health: 'DEGRADED' }],
    },
    healthData: {
      stream_id: ids.streamId,
      stream_status: 'RUNNING',
      health: 'DEGRADED',
      limit: 100,
      summary: {
        total_routes: 2,
        healthy_routes: 1,
        degraded_routes: 1,
        unhealthy_routes: 0,
        disabled_routes: 0,
        idle_routes: 0,
      },
      routes: [
        { route_id: ids.routeId, status: 'RUNNING', destination_status: 'RUNNING' },
        { route_id: ids.routeId + 1, status: 'RATE_LIMITED_DESTINATION', destination_status: 'DEGRADED' },
      ],
    },
    statsData: {
      stream_id: ids.streamId,
      stream_status: 'RUNNING',
      checkpoint: { type: 'OFFSET', value: { last_id: 'evt-5' } },
      summary: { total_logs: timelineItems.length },
      last_seen: { stream: '2026-05-07T12:02:00Z' },
      routes: [
        { route_id: ids.routeId, success_count: 2, failure_count: 1, retry_success_count: 1 },
      ],
      recent_logs: timelineItems.slice(0, 3),
    },
    timelineData: {
      stream_id: ids.streamId,
      total: timelineItems.length,
      items: timelineItems,
    },
    logSearchData: {
      total_returned: timelineItems.length,
      filters: { stream_id: ids.streamId, limit: 100 },
      logs: timelineItems,
    },
    logPageData: {
      total_returned: timelineItems.length,
      has_next: false,
      next_cursor_created_at: null,
      next_cursor_id: null,
      items: timelineItems,
    },
    trendData: {
      total: 3,
      buckets: [
        { stage: 'route_send_failed', count: 1, latest_created_at: '2026-05-07T12:01:30Z', stream_id: ids.streamId, route_id: ids.routeId },
        { stage: 'source_rate_limited', count: 1, latest_created_at: '2026-05-07T12:01:00Z', stream_id: ids.streamId, route_id: ids.routeId },
        {
          stage: 'destination_rate_limited',
          count: 1,
          latest_created_at: '2026-05-07T12:01:40Z',
          stream_id: ids.streamId,
          route_id: ids.routeId + 1,
        },
      ],
    },
  }
}

function asJson(value: unknown): string {
  return prettyJson(value)
}

export const DEMO_SCENARIO_PRESETS: DemoScenarioPreset[] = [
  {
    key: 'cybereason-syslog',
    name: 'Cybereason -> Syslog',
    sourceType: 'EDR API polling',
    destinationTopology: 'Single Syslog destination',
    explanation: 'Endpoint threat incidents flowing into one syslog collector for SOC triage.',
    ids: { connectorId: 'demo-c-101', sourceId: 'demo-s-101', streamId: '101', routeId: '201', destinationId: '301' },
    connectorSave: asJson({ name: 'demo-cybereason-connector', vendor: 'cybereason', mode: 'demo' }),
    sourceSave: asJson({
      enabled: true,
      config_json: { url: 'https://api.example.com/cybereason/malop', method: 'POST' },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'demo-cybereason-stream',
      enabled: true,
      polling_interval: 120,
      config_json: { method: 'POST', endpoint: '/cybereason/malop', event_array_path: '$.result.data' },
      rate_limit_json: { per_sec: 1 },
    }),
    mappingRawSample: asJson({ result: { data: [{ guid: 'malop-1', severity: 'HIGH', host: 'endpoint-demo-01' }] } }),
    mappingRows: [
      { outputField: 'alert_id', sourcePath: '$.guid', sampleValue: 'malop-1' },
      { outputField: 'severity', sourcePath: '$.severity', sampleValue: 'HIGH' },
      { outputField: 'host', sourcePath: '$.host', sampleValue: 'endpoint-demo-01' },
    ],
    mappingEventArrayPath: '$.result.data',
    mappingEnrichment: asJson({ vendor: 'cybereason', feed: 'malop_api', env: 'demo' }),
    routeSave: asJson({ route_enabled: true, destination_enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }),
    routeConfig: asJson({ route: { enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }, destination: { type: 'SYSLOG_TCP' } }),
    destinationSave: asJson({
      name: 'collector-demo',
      enabled: true,
      config_json: { type: 'SYSLOG_TCP', host: 'collector-demo', port: 5140 },
      rate_limit_json: { per_sec: 20 },
    }),
    destinationConfig: asJson({ destination: { type: 'SYSLOG_TCP', host: 'collector-demo', port: 5140, enabled: true } }),
    ...buildCommonObservabilitySeed('Cybereason -> Syslog', { streamId: 101, routeId: 201, destinationId: 301 }),
  },
  {
    key: 'vectra-multi-syslog',
    name: 'Vectra AI -> Multi Syslog',
    sourceType: 'NDR detections',
    destinationTopology: 'Dual Syslog fan-out',
    explanation: 'NDR detections fanned out to primary/secondary syslog collectors.',
    ids: { connectorId: 'demo-c-102', sourceId: 'demo-s-102', streamId: '102', routeId: '202', destinationId: '302' },
    connectorSave: asJson({ name: 'demo-vectra-connector', vendor: 'vectra_ai', mode: 'demo' }),
    sourceSave: asJson({
      enabled: true,
      config_json: { url: 'https://api.example.com/vectra/detections', method: 'GET' },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'demo-vectra-stream',
      enabled: true,
      polling_interval: 90,
      config_json: { method: 'GET', endpoint: '/vectra/detections', event_array_path: '$.results' },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({ results: [{ id: 'vectra-1', threat: 'C2', certainty: 91, host_name: 'host-demo-02' }] }),
    mappingRows: [
      { outputField: 'detection_id', sourcePath: '$.id', sampleValue: 'vectra-1' },
      { outputField: 'threat_type', sourcePath: '$.threat', sampleValue: 'C2' },
      { outputField: 'certainty', sourcePath: '$.certainty', sampleValue: 91 },
    ],
    mappingEventArrayPath: '$.results',
    mappingEnrichment: asJson({ vendor: 'vectra_ai', feed: 'detection', env: 'demo' }),
    routeSave: asJson({ route_enabled: true, destination_enabled: true, failure_policy: 'LOG_AND_CONTINUE' }),
    routeConfig: asJson({ route: { enabled: true, failure_policy: 'LOG_AND_CONTINUE' }, destination: { type: 'SYSLOG_UDP' } }),
    destinationSave: asJson({
      name: 'collector-demo-primary',
      enabled: true,
      config_json: { type: 'SYSLOG_UDP', host: 'collector-demo-primary', port: 5514 },
      rate_limit_json: { per_sec: 30 },
    }),
    destinationConfig: asJson({ destination: { type: 'SYSLOG_UDP', host: 'collector-demo-primary', port: 5514, enabled: true } }),
    ...buildCommonObservabilitySeed('Vectra AI -> Multi Syslog', { streamId: 102, routeId: 202, destinationId: 302 }),
  },
  {
    key: 'crowdstrike-webhook',
    name: 'CrowdStrike -> Webhook',
    sourceType: 'EDR detections',
    destinationTopology: 'Single webhook destination',
    explanation: 'Endpoint detections routed to a webhook-style SOC aggregator.',
    ids: { connectorId: 'demo-c-103', sourceId: 'demo-s-103', streamId: '103', routeId: '203', destinationId: '303' },
    connectorSave: asJson({ name: 'demo-crowdstrike-connector', vendor: 'crowdstrike', mode: 'demo' }),
    sourceSave: asJson({
      enabled: true,
      config_json: { url: 'https://api.example.com/crowdstrike/detections', method: 'GET' },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'demo-crowdstrike-stream',
      enabled: true,
      polling_interval: 120,
      config_json: { method: 'GET', endpoint: '/crowdstrike/detections', event_array_path: '$.resources' },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({ resources: [{ detection_id: 'cs-1', severity: 'high', tactic: 'credential-access' }] }),
    mappingRows: [
      { outputField: 'detection_id', sourcePath: '$.detection_id', sampleValue: 'cs-1' },
      { outputField: 'severity', sourcePath: '$.severity', sampleValue: 'high' },
      { outputField: 'tactic', sourcePath: '$.tactic', sampleValue: 'credential-access' },
    ],
    mappingEventArrayPath: '$.resources',
    mappingEnrichment: asJson({ vendor: 'crowdstrike', product: 'falcon', env: 'demo' }),
    routeSave: asJson({ route_enabled: true, destination_enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }),
    routeConfig: asJson({ route: { enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }, destination: { type: 'WEBHOOK_POST' } }),
    destinationSave: asJson({
      name: 'webhook-demo-destination',
      enabled: true,
      config_json: { endpoint: 'https://api.example.com/collector/webhook', auth_header: 'Bearer ${TOKEN}' },
      rate_limit_json: { per_sec: 15 },
    }),
    destinationConfig: asJson({ destination: { type: 'WEBHOOK_POST', endpoint: 'https://api.example.com/collector/webhook', enabled: true } }),
    ...buildCommonObservabilitySeed('CrowdStrike -> Webhook', { streamId: 103, routeId: 203, destinationId: 303 }),
  },
  {
    key: 'microsoft-syslog-webhook',
    name: 'Microsoft Defender -> Syslog + Webhook',
    sourceType: 'Cloud alert API',
    destinationTopology: 'Hybrid syslog + webhook',
    explanation: 'Cloud alerts delivered to syslog and webhook destinations for mixed SIEM/SOAR workflow.',
    ids: { connectorId: 'demo-c-104', sourceId: 'demo-s-104', streamId: '104', routeId: '204', destinationId: '304' },
    connectorSave: asJson({ name: 'demo-microsoft-defender-connector', vendor: 'microsoft_defender', mode: 'demo' }),
    sourceSave: asJson({
      enabled: true,
      config_json: { url: 'https://api.example.com/microsoft/alerts', method: 'GET' },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'demo-microsoft-defender-stream',
      enabled: true,
      polling_interval: 120,
      config_json: { method: 'GET', endpoint: '/microsoft/alerts', event_array_path: '$.value' },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({ value: [{ id: 'md-1', title: 'Suspicious grant', severity: 'high', serviceSource: 'Defender' }] }),
    mappingRows: [
      { outputField: 'alert_id', sourcePath: '$.id', sampleValue: 'md-1' },
      { outputField: 'title', sourcePath: '$.title', sampleValue: 'Suspicious grant' },
      { outputField: 'severity', sourcePath: '$.severity', sampleValue: 'high' },
    ],
    mappingEventArrayPath: '$.value',
    mappingEnrichment: asJson({ vendor: 'microsoft', product: 'defender', env: 'demo' }),
    routeSave: asJson({ route_enabled: true, destination_enabled: true, failure_policy: 'LOG_AND_CONTINUE' }),
    routeConfig: asJson({ route: { enabled: true, failure_policy: 'LOG_AND_CONTINUE' }, destination: { type: 'SYSLOG_TCP+WEBHOOK_POST' } }),
    destinationSave: asJson({
      name: 'hybrid-demo-destination',
      enabled: true,
      config_json: {
        primary_syslog_host: 'collector-demo',
        primary_syslog_port: 6514,
        webhook_endpoint: 'https://api.example.com/collector/msft',
      },
      rate_limit_json: { per_sec: 25 },
    }),
    destinationConfig: asJson({
      destination: {
        type: 'WEBHOOK_POST',
        endpoint: 'https://api.example.com/collector/msft',
        mirror_syslog_host: 'collector-demo',
        enabled: true,
      },
    }),
    ...buildCommonObservabilitySeed('Microsoft Defender -> Syslog + Webhook', { streamId: 104, routeId: 204, destinationId: 304 }),
  },
  {
    key: 'generic-webhook-receiver-demo',
    name: 'Generic Webhook Receiver Demo',
    sourceType: 'Generic webhook polling/receiver mirror',
    destinationTopology: 'Demo webhook collector',
    explanation: 'Generic producer-agnostic webhook event simulation for UI onboarding rehearsal.',
    ids: { connectorId: 'demo-c-105', sourceId: 'demo-s-105', streamId: '105', routeId: '205', destinationId: '305' },
    connectorSave: asJson({ name: 'demo-generic-webhook-connector', vendor: 'generic_webhook', mode: 'demo' }),
    sourceSave: asJson({
      enabled: true,
      config_json: { url: 'https://api.example.com/webhook/events', method: 'GET' },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'demo-generic-webhook-stream',
      enabled: true,
      polling_interval: 60,
      config_json: { method: 'GET', endpoint: '/webhook/events', event_array_path: '$.events' },
      rate_limit_json: { per_sec: 3 },
    }),
    mappingRawSample: asJson({ events: [{ event_id: 'wh-1', event_type: 'security.alert.created', source_system: 'producer-demo' }] }),
    mappingRows: [
      { outputField: 'event_id', sourcePath: '$.event_id', sampleValue: 'wh-1' },
      { outputField: 'event_type', sourcePath: '$.event_type', sampleValue: 'security.alert.created' },
      { outputField: 'source_system', sourcePath: '$.source_system', sampleValue: 'producer-demo' },
    ],
    mappingEventArrayPath: '$.events',
    mappingEnrichment: asJson({ vendor: 'generic', product: 'webhook_receiver', env: 'demo' }),
    routeSave: asJson({ route_enabled: true, destination_enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }),
    routeConfig: asJson({ route: { enabled: true, failure_policy: 'RETRY_AND_BACKOFF' }, destination: { type: 'WEBHOOK_POST' } }),
    destinationSave: asJson({
      name: 'collector-demo',
      enabled: true,
      config_json: { endpoint: 'https://api.example.com/collector-demo/events' },
      rate_limit_json: { per_sec: 20 },
    }),
    destinationConfig: asJson({ destination: { type: 'WEBHOOK_POST', endpoint: 'https://api.example.com/collector-demo/events', enabled: true } }),
    ...buildCommonObservabilitySeed('Generic Webhook Receiver Demo', { streamId: 105, routeId: 205, destinationId: 305 }),
  },
]
