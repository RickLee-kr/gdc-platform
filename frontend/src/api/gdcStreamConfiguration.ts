import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

export type StreamConfigurationField = {
  label: string
  value: string
  configured: boolean
  sensitive?: boolean
}

export type StreamConfigurationSection = {
  title: string
  fields: StreamConfigurationField[]
}

export type StreamConfigurationResponse = {
  stream_id: number
  stream_name: string
  sections: StreamConfigurationSection[]
  message: string
}

export type StreamSampleDataResponse = {
  stream_id: number
  has_sample_data: boolean
  last_test_response: Record<string, unknown> | null
  sample_events: Record<string, unknown>[]
  sample_count: number
  union_schema: Record<string, unknown> | null
  event_root_path: string | null
  record_path: string | null
  checkpoint_test_result: Record<string, unknown> | null
  incremental_test_result: Record<string, unknown> | null
  saved_at: string | null
  message: string
}

export type StreamDeduplicationConfig = {
  enabled: boolean
  key_field: string
  custom_jsonpath: string | null
  duplicate_handling: 'skip_duplicate' | 'keep_latest' | 'keep_first'
  scope: 'current_run' | 'checkpoint_window' | 'last_n_hours'
  window_hours: number | null
}

/** Last observed dedup counters from GET .../deduplication (`last_runtime_dedup_summary`). */
export type StreamDedupRuntimeSummary = {
  total_events?: number | null
  inserted?: number | null
  duplicate_events?: number | null
  duplicate_by_event_id?: number | null
  duplicate_by_stellar_uuid?: number | null
  duplicate_by_id?: number | null
  duplicate_by_custom_key?: number | null
  duplicate_handling?: string | null
  dedup_scope?: string | null
  recorded_at?: string | null
  registry_seed_duplicates?: number | null
  current_run_duplicates?: number | null
  registry_recorded?: number | null
  registry_skipped?: number | null
  registry_record_stage?: string | null
  degraded?: boolean
}

export type StreamDeduplicationStatus = StreamDeduplicationConfig & {
  last_runtime_duplicate_count?: number
  last_runtime_dedup_summary?: StreamDedupRuntimeSummary | null
  last_runtime_stats_degraded?: boolean
}

export type StreamIncrementalTestResponse = {
  stream_id: number
  ok: boolean
  http_status: number | null
  message: string
  preview_events: Record<string, unknown>[]
  next_checkpoint_preview: Record<string, unknown> | null
  checkpoint_unchanged: boolean
  substituted_request_body: string | null
  event_root_path: string | null
  record_path: string | null
}

export type StreamReplayMode =
  | 'time_range'
  | 'checkpoint_preview'
  | 'delivery_log'
  | 'last_n_minutes'
  | 'failed_events'

export type StreamReplayResponse = {
  stream_id: number
  mode: StreamReplayMode
  dry_run: boolean
  apply_dedup?: boolean
  outcome: string
  message: string
  event_count: number | null
  checkpoint_unchanged: boolean
  preview_message_count?: number | null
  backfill_job_id?: number | null
  dedup_summary?: Record<string, unknown> | null
}

export type StreamCheckpointManageResponse = {
  stream_id: number
  checkpoint_type: string | null
  checkpoint_value: Record<string, unknown> | null
  framework_enabled: boolean
  checkpoint_mode: string
  fetch_checkpoint: Record<string, unknown> | null
  delivery_checkpoint: Record<string, unknown> | null
  legacy_checkpoint: Record<string, unknown> | null
  updated_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  last_collected_event_at: string | null
}

export async function fetchStreamConfiguration(streamId: number): Promise<StreamConfigurationResponse | null> {
  return safeRequestJson<StreamConfigurationResponse>(`${RT}/streams/${streamId}/configuration`)
}

export async function fetchStreamSampleData(streamId: number): Promise<StreamSampleDataResponse | null> {
  return safeRequestJson<StreamSampleDataResponse>(`${RT}/streams/${streamId}/sample-data`)
}

export async function saveStreamSampleData(
  streamId: number,
  payload: Partial<{
    last_test_response: Record<string, unknown>
    sample_events: Record<string, unknown>[]
    union_schema: Record<string, unknown>
    event_root_path: string
    record_path: string
    incremental_test_result: Record<string, unknown>
    checkpoint_test_result: Record<string, unknown>
  }>,
): Promise<StreamSampleDataResponse> {
  return requestJson<StreamSampleDataResponse>(`${RT}/streams/${streamId}/sample-data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchStreamDeduplication(streamId: number): Promise<StreamDeduplicationStatus | null> {
  return safeRequestJson<StreamDeduplicationStatus>(`${RT}/streams/${streamId}/deduplication`)
}

export async function saveStreamDeduplication(
  streamId: number,
  payload: StreamDeduplicationConfig,
): Promise<StreamDeduplicationConfig> {
  return requestJson<StreamDeduplicationConfig>(`${RT}/streams/${streamId}/deduplication`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function runStreamIncrementalTest(
  streamId: number,
  payload?: { checkpoint_override?: Record<string, unknown>; request_body?: unknown },
): Promise<StreamIncrementalTestResponse> {
  return requestJson<StreamIncrementalTestResponse>(`${RT}/streams/${streamId}/incremental-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
}

export type StreamReplayRequestPayload = {
  mode: StreamReplayMode
  dry_run?: boolean
  /** When true (default), skip events already recorded in the dedup registry. */
  apply_dedup?: boolean
  start_time?: string
  end_time?: string
  last_n_minutes?: number
  checkpoint_override?: Record<string, unknown>
  delivery_log_id?: number
  limit?: number
}

export async function runStreamOperationalReplay(
  streamId: number,
  payload: StreamReplayRequestPayload,
): Promise<StreamReplayResponse> {
  return requestJson<StreamReplayResponse>(`${RT}/streams/${streamId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchStreamCheckpointManage(streamId: number): Promise<StreamCheckpointManageResponse | null> {
  return safeRequestJson<StreamCheckpointManageResponse>(`${RT}/streams/${streamId}/checkpoint`)
}

export async function updateStreamCheckpointManage(
  streamId: number,
  payload: { checkpoint_type?: string; checkpoint_value: Record<string, unknown> },
): Promise<StreamCheckpointManageResponse> {
  return requestJson<StreamCheckpointManageResponse>(`${RT}/streams/${streamId}/checkpoint`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function resetStreamCheckpointManage(
  streamId: number,
  reason?: string,
): Promise<StreamCheckpointManageResponse> {
  return requestJson<StreamCheckpointManageResponse>(`${RT}/streams/${streamId}/checkpoint/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason ?? null }),
  })
}


export type StreamIncrementalFetchConfig = {
  strategy: 'cursor' | 'timestamp_watermark' | 'closed_window_watermark' | 'custom' | null
  watermark_field: string | null
  cursor_field: string | null
  tie_breaker_field: string | null
  stability_lag_seconds: number | null
  initial_lookback_seconds: number | null
}

export type StreamIncrementalFetchStatus = StreamIncrementalFetchConfig & {
  framework_enabled: boolean
  fetch_watermark: unknown
  connector_cursor: unknown
  delivery_checkpoint: Record<string, unknown> | null
  last_fetch_at: string | null
  last_delivery_at: string | null
  fetch_window: { lower_bound: string; upper_bound: string } | null
  last_runtime_summary: Record<string, unknown> | null
}

export async function fetchStreamIncrementalFetch(streamId: number): Promise<StreamIncrementalFetchStatus | null> {
  return safeRequestJson<StreamIncrementalFetchStatus>(`${RT}/streams/${streamId}/incremental-fetch`)
}

export async function saveStreamIncrementalFetch(
  streamId: number,
  payload: Partial<StreamIncrementalFetchConfig>,
): Promise<StreamIncrementalFetchConfig> {
  return requestJson<StreamIncrementalFetchConfig>(`${RT}/streams/${streamId}/incremental-fetch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
