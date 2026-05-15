import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const BF = `${GDC_API_PREFIX}/backfill`

export type BackfillJobDto = {
  id: number
  stream_id: number
  source_type: string
  status: string
  backfill_mode: string
  requested_by: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  source_config_snapshot_json: Record<string, unknown>
  checkpoint_snapshot_json: Record<string, unknown> | null
  runtime_options_json: Record<string, unknown>
  progress_json: Record<string, unknown>
  error_summary: string | null
  delivery_summary_json: Record<string, unknown> | null
}

export type BackfillProgressEventDto = {
  id: number
  backfill_job_id: number
  stream_id: number
  event_type: string
  level: string
  message: string
  progress_json: Record<string, unknown> | null
  error_code: string | null
  created_at: string
}

export async function fetchBackfillJobs(limit = 100): Promise<BackfillJobDto[] | null> {
  const q = new URLSearchParams({ limit: String(limit) })
  return safeRequestJson<BackfillJobDto[]>(`${BF}/jobs?${q.toString()}`)
}

export async function fetchBackfillJob(jobId: number): Promise<BackfillJobDto | null> {
  return safeRequestJson<BackfillJobDto>(`${BF}/jobs/${jobId}`)
}

export async function startBackfillJob(jobId: number): Promise<BackfillJobDto> {
  return requestJson<BackfillJobDto>(`${BF}/jobs/${jobId}/start`, { method: 'POST' })
}

export async function cancelBackfillJob(jobId: number): Promise<BackfillJobDto> {
  return requestJson<BackfillJobDto>(`${BF}/jobs/${jobId}/cancel`, { method: 'POST' })
}

export async function replayStreamBackfill(payload: {
  stream_id: number
  start_time: string
  end_time: string
  dry_run?: boolean
  requested_by?: string
}): Promise<BackfillJobDto> {
  return requestJson<BackfillJobDto>(`${BF}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchBackfillJobEvents(jobId: number): Promise<BackfillProgressEventDto[] | null> {
  return safeRequestJson<BackfillProgressEventDto[]>(`${BF}/jobs/${jobId}/events`)
}
