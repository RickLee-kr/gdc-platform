import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import type {
  CheckpointHistoryResponse,
  CheckpointTraceResponse,
  DashboardSummaryResponse,
  ValidationOperationalSummaryResponse,
  MappingUIConfigResponse,
  RuntimeAlertSummaryResponse,
  RuntimeRouteEnabledSaveResponse,
  RuntimeLogSearchResponse,
  RuntimeLogsPageResponse,
  RuntimeStreamControlResponse,
  RuntimeStreamRunOnceResponse,
  RuntimeSystemResourcesResponse,
  StreamHealthResponse,
  StreamRuntimeMetricsResponse,
  StreamRuntimeStatsHealthBundleResponse,
  StreamRuntimeStatsResponse,
  RuntimeTimelineResponse,
  RuntimeTraceResponse,
  DashboardOutcomeTimeseriesResponse,
} from './types/gdcApi'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type MetricsWindow = '15m' | '1h' | '6h' | '24h'

export async function fetchRuntimeDashboardSummary(
  limit = 100,
  window: MetricsWindow = '1h',
): Promise<DashboardSummaryResponse | null> {
  const q = new URLSearchParams({ limit: String(limit), window })
  return safeRequestJson<DashboardSummaryResponse>(`${RT}/dashboard/summary?${q.toString()}`, readJsonOpts)
}

export async function fetchRuntimeValidationOperationalSummary(): Promise<ValidationOperationalSummaryResponse | null> {
  return safeRequestJson<ValidationOperationalSummaryResponse>(`${RT}/validation/operational-summary`, readJsonOpts)
}

export async function fetchRuntimeDashboardOutcomeTimeseries(
  window: MetricsWindow = '1h',
): Promise<DashboardOutcomeTimeseriesResponse | null> {
  const q = new URLSearchParams({ window })
  return safeRequestJson<DashboardOutcomeTimeseriesResponse>(
    `${RT}/dashboard/outcome-timeseries?${q.toString()}`,
    readJsonOpts,
  )
}

export async function fetchRuntimeSystemResources(): Promise<RuntimeSystemResourcesResponse | null> {
  return safeRequestJson<RuntimeSystemResourcesResponse>(`${RT}/system/resources`, readJsonOpts)
}

export async function fetchRuntimeAlertSummary(
  window: MetricsWindow = '1h',
  limit = 100,
): Promise<RuntimeAlertSummaryResponse | null> {
  const q = new URLSearchParams({ window, limit: String(limit) })
  return safeRequestJson<RuntimeAlertSummaryResponse>(`${RT}/logs/alerts/summary?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamRuntimeStats(streamId: number, limit = 100): Promise<StreamRuntimeStatsResponse | null> {
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<StreamRuntimeStatsResponse>(`${RT}/stats/stream/${streamId}?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamRuntimeHealth(streamId: number, limit = 100): Promise<StreamHealthResponse | null> {
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<StreamHealthResponse>(`${RT}/health/stream/${streamId}?${q.toString()}`, readJsonOpts)
}

/** One round-trip for stats + health (single delivery_logs scan server-side). */
export async function fetchStreamRuntimeStatsHealth(
  streamId: number,
  limit = 100,
): Promise<StreamRuntimeStatsHealthBundleResponse | null> {
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<StreamRuntimeStatsHealthBundleResponse>(
    `${RT}/streams/${streamId}/stats-health?${q.toString()}`,
    readJsonOpts,
  )
}

export async function fetchStreamRuntimeMetrics(
  streamId: number,
  window: MetricsWindow = '1h',
): Promise<StreamRuntimeMetricsResponse | null> {
  const q = new URLSearchParams({ window })
  return safeRequestJson<StreamRuntimeMetricsResponse>(`${RT}/streams/${streamId}/metrics?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamMappingUiConfig(streamId: number): Promise<MappingUIConfigResponse | null> {
  return safeRequestJson<MappingUIConfigResponse>(`${RT}/streams/${streamId}/mapping-ui/config`, readJsonOpts)
}

export async function fetchStreamRuntimeTimeline(
  streamId: number,
  opts: { limit?: number } = {},
): Promise<RuntimeTimelineResponse | null> {
  const limit = opts.limit ?? 100
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<RuntimeTimelineResponse>(`${RT}/timeline/stream/${streamId}?${q.toString()}`, readJsonOpts)
}

export type RuntimeLogSearchParams = {
  stream_id?: number
  route_id?: number
  destination_id?: number
  run_id?: string
  stage?: string
  level?: string
  status?: string
  error_code?: string
  partial_success?: boolean
  limit?: number
  window?: MetricsWindow
}

export async function searchRuntimeDeliveryLogs(params: RuntimeLogSearchParams): Promise<RuntimeLogSearchResponse | null> {
  const q = new URLSearchParams()
  if (params.stream_id != null) q.set('stream_id', String(params.stream_id))
  if (params.route_id != null) q.set('route_id', String(params.route_id))
  if (params.destination_id != null) q.set('destination_id', String(params.destination_id))
  if (params.run_id != null && params.run_id.trim() !== '') q.set('run_id', params.run_id.trim())
  if (params.stage != null) q.set('stage', params.stage)
  if (params.level != null) q.set('level', params.level)
  if (params.status != null) q.set('status', params.status)
  if (params.error_code != null) q.set('error_code', params.error_code)
  if (params.partial_success === true) q.set('partial_success', 'true')
  if (params.partial_success === false) q.set('partial_success', 'false')
  q.set('limit', String(params.limit ?? 200))
  q.set('window', params.window ?? '1h')
  return safeRequestJson<RuntimeLogSearchResponse>(`${RT}/logs/search?${q.toString()}`, readJsonOpts)
}

export type RuntimeLogsPageParams = {
  limit?: number
  cursor_created_at?: string
  cursor_id?: number
  stream_id?: number
  route_id?: number
  destination_id?: number
  run_id?: string
  stage?: string
  level?: string
  status?: string
  error_code?: string
  partial_success?: boolean
  window?: MetricsWindow
}

export async function fetchRuntimeLogsPage(params: RuntimeLogsPageParams = {}): Promise<RuntimeLogsPageResponse | null> {
  const q = new URLSearchParams()
  q.set('limit', String(params.limit ?? 100))
  if (params.cursor_created_at != null && params.cursor_id != null) {
    q.set('cursor_created_at', params.cursor_created_at)
    q.set('cursor_id', String(params.cursor_id))
  }
  if (params.stream_id != null) q.set('stream_id', String(params.stream_id))
  if (params.route_id != null) q.set('route_id', String(params.route_id))
  if (params.destination_id != null) q.set('destination_id', String(params.destination_id))
  if (params.run_id != null && params.run_id.trim() !== '') q.set('run_id', params.run_id.trim())
  if (params.stage != null) q.set('stage', params.stage)
  if (params.level != null) q.set('level', params.level)
  if (params.status != null) q.set('status', params.status)
  if (params.error_code != null) q.set('error_code', params.error_code)
  if (params.partial_success === true) q.set('partial_success', 'true')
  if (params.partial_success === false) q.set('partial_success', 'false')
  if (params.window != null) q.set('window', params.window)
  return safeRequestJson<RuntimeLogsPageResponse>(`${RT}/logs/page?${q.toString()}`, readJsonOpts)
}

export async function fetchCheckpointTrace(runId: string): Promise<CheckpointTraceResponse | null> {
  const rid = runId.trim()
  if (!rid) return null
  const q = new URLSearchParams({ run_id: rid })
  return safeRequestJson<CheckpointTraceResponse>(`${RT}/checkpoints/trace?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamCheckpointHistory(streamId: number, limit = 50): Promise<CheckpointHistoryResponse | null> {
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<CheckpointHistoryResponse>(`${RT}/checkpoints/streams/${streamId}/history?${q.toString()}`, readJsonOpts)
}

export async function fetchRuntimeLogTrace(logId: number): Promise<RuntimeTraceResponse | null> {
  return safeRequestJson<RuntimeTraceResponse>(`${RT}/logs/${logId}/trace`, readJsonOpts)
}

export async function fetchRuntimeRunTrace(runId: string): Promise<RuntimeTraceResponse | null> {
  const rid = runId.trim()
  if (!rid) return null
  return safeRequestJson<RuntimeTraceResponse>(`${RT}/runs/${encodeURIComponent(rid)}/trace`, readJsonOpts)
}

export async function startRuntimeStream(streamId: number): Promise<RuntimeStreamControlResponse | null> {
  return safeRequestJson<RuntimeStreamControlResponse>(`${RT}/streams/${streamId}/start`, { method: 'POST' })
}

export async function stopRuntimeStream(streamId: number): Promise<RuntimeStreamControlResponse | null> {
  return safeRequestJson<RuntimeStreamControlResponse>(`${RT}/streams/${streamId}/stop`, { method: 'POST' })
}

/** Single StreamRunner cycle; throws on HTTP/network error with backend detail when available. */
export async function runStreamOnce(streamId: number): Promise<RuntimeStreamRunOnceResponse> {
  return requestJson<RuntimeStreamRunOnceResponse>(`${RT}/streams/${streamId}/run-once`, { method: 'POST' })
}

export async function saveRuntimeRouteEnabledState(
  routeId: number,
  enabled: boolean,
  options?: { disable_reason?: string | null },
): Promise<RuntimeRouteEnabledSaveResponse | null> {
  const body: Record<string, unknown> = { enabled }
  if (!enabled && options?.disable_reason != null && String(options.disable_reason).trim() !== '') {
    body.disable_reason = String(options.disable_reason).trim()
  }
  return safeRequestJson<RuntimeRouteEnabledSaveResponse>(`${RT}/routes/${routeId}/enabled/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type RuntimeRouteFailurePolicySaveResponse = {
  route_id: number
  stream_id: number
  destination_id: number
  failure_policy: string
  message: string
}

export async function saveRuntimeRouteFailurePolicy(
  routeId: number,
  failure_policy: string,
): Promise<RuntimeRouteFailurePolicySaveResponse | null> {
  return safeRequestJson<RuntimeRouteFailurePolicySaveResponse>(`${RT}/routes/${routeId}/failure-policy/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failure_policy }),
  })
}
