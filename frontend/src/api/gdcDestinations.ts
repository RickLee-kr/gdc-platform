import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type DestinationType = 'SYSLOG_UDP' | 'SYSLOG_TCP' | 'SYSLOG_TLS' | 'WEBHOOK_POST'

export type TlsVerifyMode = 'strict' | 'insecure_skip_verify'

export type DestinationRead = {
  id: number
  name: string
  destination_type: DestinationType
  config_json: Record<string, unknown>
  rate_limit_json: Record<string, unknown>
  enabled: boolean
  created_at?: string | null
  updated_at?: string | null
  last_connectivity_test_at?: string | null
  last_connectivity_test_success?: boolean | null
  last_connectivity_test_latency_ms?: number | null
  last_connectivity_test_message?: string | null
}

export type DestinationRouteUsage = {
  route_id: number
  stream_id: number
  stream_name: string
  route_enabled?: boolean
  route_status?: string
}

export type DestinationListItem = DestinationRead & {
  streams_using_count: number
  routes: DestinationRouteUsage[]
}

export type DestinationWritePayload = {
  name: string
  destination_type: DestinationRead['destination_type']
  config_json: Record<string, unknown>
  rate_limit_json?: Record<string, unknown>
  enabled?: boolean
}

function isDestinationListItem(row: unknown): row is DestinationListItem {
  if (!row || typeof row !== 'object') return false
  const o = row as Record<string, unknown>
  return (
    typeof o.id === 'number' &&
    typeof o.streams_using_count === 'number' &&
    Array.isArray(o.routes)
  )
}

export async function fetchDestinationsList(): Promise<DestinationListItem[]> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/destinations/`, readJsonOpts)
  if (!Array.isArray(raw)) return []
  const out: DestinationListItem[] = []
  for (const row of raw) {
    if (isDestinationListItem(row)) {
      out.push(row)
    }
  }
  return out
}

export async function fetchDestinationById(destinationId: number): Promise<DestinationRead | null> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/destinations/${destinationId}`, readJsonOpts)
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return null
  if (!('id' in raw) || typeof (raw as DestinationRead).id !== 'number') return null
  return raw as DestinationRead
}

export async function createDestination(payload: DestinationWritePayload): Promise<DestinationRead> {
  return requestJson<DestinationRead>(`${GDC_API_PREFIX}/destinations/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateDestination(destinationId: number, payload: Partial<DestinationWritePayload>): Promise<DestinationRead> {
  return requestJson<DestinationRead>(`${GDC_API_PREFIX}/destinations/${destinationId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteDestination(destinationId: number): Promise<void> {
  await requestJson<unknown>(`${GDC_API_PREFIX}/destinations/${destinationId}`, {
    method: 'DELETE',
  })
}

export type DestinationTestResult = {
  success: boolean
  latency_ms: number
  message: string
  tested_at: string
  detail?: Record<string, unknown> | null
}

export async function testDestination(destinationId: number): Promise<DestinationTestResult> {
  return requestJson<DestinationTestResult>(`${GDC_API_PREFIX}/destinations/${destinationId}/test`, {
    method: 'POST',
  })
}

/** Connectivity probe using unsaved form values (does not write destination test columns until saved row test). */
export async function previewTestDestination(payload: DestinationWritePayload & { name: string }): Promise<DestinationTestResult> {
  return requestJson<DestinationTestResult>(`${GDC_API_PREFIX}/destinations/preview-test`, {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      destination_type: payload.destination_type,
      config_json: payload.config_json,
    }),
  })
}
