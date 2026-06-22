import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type SchemaDriftStatusFilter = 'open' | 'acknowledged' | 'all'

export type SchemaFieldDriftFinding = {
  id: number
  field_path: string
  category: string
  status: string
  first_detected_at: string
  last_confirmed_at: string
  finding?: Record<string, string> | null
  operator_note?: string | null
}

export type StreamSchemaFieldDriftsResponse = {
  stream_id: number
  drift_detection_enabled: boolean
  baseline_established: boolean
  baseline_established_at: string | null
  baseline_path_count: number
  baseline_version: number
  baseline_reset_at: string | null
  status_filter: SchemaDriftStatusFilter
  findings: SchemaFieldDriftFinding[]
  finding_count: number
}

export type StreamSchemaFieldDriftsSummaryResponse = {
  stream_id: number
  open_count: number
  acknowledged_count: number
  resolved_count: number
  by_category: {
    field_added: number
    field_removed: number
    field_type_changed: number
  }
  baseline_version: number
  baseline_established_at: string | null
  baseline_reset_at: string | null
  drift_detection_enabled: boolean
}

export async function fetchStreamSchemaFieldDrifts(
  streamId: number,
  status: SchemaDriftStatusFilter = 'open',
): Promise<StreamSchemaFieldDriftsResponse | null> {
  const q = new URLSearchParams({ status })
  return safeRequestJson<StreamSchemaFieldDriftsResponse>(
    `${RT}/streams/${streamId}/schema-field-drifts?${q.toString()}`,
    readJsonOpts,
  )
}

export async function fetchStreamSchemaFieldDriftsSummary(
  streamId: number,
  options?: GdcSignalOptions,
): Promise<StreamSchemaFieldDriftsSummaryResponse | null> {
  return safeRequestJson<StreamSchemaFieldDriftsSummaryResponse>(
    `${RT}/streams/${streamId}/schema-field-drifts/summary`,
    readJsonWithSignal(readJsonOpts, options?.signal),
  )
}

export async function acknowledgeSchemaFieldDrift(
  streamId: number,
  findingId: number,
  note?: string,
): Promise<{ id: number; status: string } | null> {
  return requestJson(`${RT}/streams/${streamId}/schema-field-drifts/${findingId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
  })
}

export async function resetStreamSchemaBaseline(
  streamId: number,
  reason: string,
): Promise<{ baseline_version: number; resolved_open_finding_count: number } | null> {
  return requestJson(`${RT}/streams/${streamId}/schema-baseline/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() }),
  })
}
