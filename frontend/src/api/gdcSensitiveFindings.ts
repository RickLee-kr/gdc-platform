import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type SensitiveStatusFilter = 'open' | 'acknowledged' | 'all'

export type SensitiveFinding = {
  id: number
  field_path: string
  sensitivity_class: string
  detection_method: string
  status: string
  confirm_run_count: number
  first_detected_at: string
  last_confirmed_at: string
  finding?: Record<string, unknown> | null
  related_drift_finding_id?: number | null
  operator_note?: string | null
}

export type StreamSensitiveFindingsResponse = {
  stream_id: number
  detection_enabled: boolean
  status_filter: SensitiveStatusFilter
  confirm_runs_required: number
  findings: SensitiveFinding[]
  finding_count: number
}

export type StreamSensitiveFindingsSummaryResponse = {
  stream_id: number
  open_count: number
  acknowledged_count: number
  resolved_count: number
  by_class: {
    secret: number
    pii: number
    security_metadata: number
  }
  detection_enabled: boolean
  confirm_runs_required: number
}

export async function fetchStreamSensitiveFindings(
  streamId: number,
  status: SensitiveStatusFilter = 'open',
): Promise<StreamSensitiveFindingsResponse | null> {
  const q = new URLSearchParams({ status })
  return safeRequestJson<StreamSensitiveFindingsResponse>(
    `${RT}/streams/${streamId}/sensitive-findings?${q.toString()}`,
    readJsonOpts,
  )
}

export async function fetchStreamSensitiveFindingsSummary(
  streamId: number,
  options?: GdcSignalOptions,
): Promise<StreamSensitiveFindingsSummaryResponse | null> {
  return safeRequestJson<StreamSensitiveFindingsSummaryResponse>(
    `${RT}/streams/${streamId}/sensitive-findings/summary`,
    readJsonWithSignal(readJsonOpts, options?.signal),
  )
}

export async function acknowledgeSensitiveFinding(
  streamId: number,
  findingId: number,
  note?: string,
): Promise<{ id: number; status: string } | null> {
  return requestJson(`${RT}/streams/${streamId}/sensitive-findings/${findingId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
  })
}
