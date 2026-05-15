import { safeRequestJson, requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { ValidationFailuresSummaryResponse } from './types/gdcApi'

const VB = `${GDC_API_PREFIX}/validation`

export type ValidationHealth = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'DISABLED'
export type ValidationType = 'AUTH_ONLY' | 'FETCH_ONLY' | 'FULL_RUNTIME'
export type RunOverallStatus = 'PASS' | 'FAIL' | 'WARN'

export type ContinuousValidationRow = {
  id: number
  name: string
  enabled: boolean
  validation_type: string
  target_stream_id: number | null
  template_key: string | null
  schedule_seconds: number
  expect_checkpoint_advance: boolean
  last_run_at: string | null
  last_status: string
  last_error: string | null
  consecutive_failures: number
  last_success_at: string | null
  last_failing_started_at?: string | null
  last_perf_snapshot_json?: string | null
  created_at: string
  updated_at: string
}

export type ValidationAlertRow = {
  id: number
  validation_id: number
  validation_run_id: number | null
  severity: string
  alert_type: string
  status: string
  title: string
  message: string
  fingerprint: string
  triggered_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  created_at: string
}

export type ValidationRunRow = {
  id: number
  validation_id: number
  stream_id: number | null
  run_id: string | null
  status: string
  validation_stage: string
  message: string
  latency_ms: number | null
  created_at: string
}

export type BuiltinValidationTemplate = {
  id: string
  title: string
  description: string
  suggested_validation_type: string
}

export async function fetchValidations(enabledOnly = false): Promise<ContinuousValidationRow[] | null> {
  const q = enabledOnly ? '?enabled_only=true' : ''
  return safeRequestJson<ContinuousValidationRow[]>(`${VB}${q}`)
}

export async function fetchValidationRuns(params?: {
  validation_id?: number
  limit?: number
}): Promise<ValidationRunRow[] | null> {
  const sp = new URLSearchParams()
  if (params?.validation_id != null) sp.set('validation_id', String(params.validation_id))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return safeRequestJson<ValidationRunRow[]>(`${VB}/runs${qs ? `?${qs}` : ''}`)
}

export async function fetchBuiltinValidationTemplates(): Promise<BuiltinValidationTemplate[] | null> {
  return safeRequestJson<BuiltinValidationTemplate[]>(`${VB}/templates`)
}

export async function postValidationRun(validationId: number): Promise<{
  validation_id: number
  stream_id: number | null
  overall_status: RunOverallStatus
  run_id: string | null
  latency_ms: number
  message: string
} | null> {
  return requestJson(`${VB}/${validationId}/run`, { method: 'POST', body: JSON.stringify({}) })
}

export async function postValidationEnable(validationId: number): Promise<ContinuousValidationRow | null> {
  return requestJson(`${VB}/${validationId}/enable`, { method: 'POST', body: JSON.stringify({}) })
}

export async function postValidationDisable(validationId: number): Promise<ContinuousValidationRow | null> {
  return requestJson(`${VB}/${validationId}/disable`, { method: 'POST', body: JSON.stringify({}) })
}

export async function fetchValidationAlerts(params?: {
  status?: string
  validation_id?: number
  limit?: number
}): Promise<ValidationAlertRow[] | null> {
  const sp = new URLSearchParams()
  if (params?.status != null) sp.set('status', params.status)
  if (params?.validation_id != null) sp.set('validation_id', String(params.validation_id))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return safeRequestJson<ValidationAlertRow[]>(`${VB}/alerts${qs ? `?${qs}` : ''}`)
}

export async function fetchValidationFailuresSummary(limit = 50): Promise<ValidationFailuresSummaryResponse | null> {
  return safeRequestJson<ValidationFailuresSummaryResponse>(`${VB}/failures/summary?limit=${encodeURIComponent(String(limit))}`)
}

export async function postValidationAlertAcknowledge(alertId: number): Promise<ValidationAlertRow | null> {
  return requestJson(`${VB}/alerts/${alertId}/acknowledge`, { method: 'POST', body: JSON.stringify({}) })
}

export async function postValidationAlertResolve(alertId: number): Promise<ValidationAlertRow | null> {
  return requestJson(`${VB}/alerts/${alertId}/resolve`, { method: 'POST', body: JSON.stringify({}) })
}
