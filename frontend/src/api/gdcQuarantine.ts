import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'

const RT = `${GDC_API_PREFIX}/runtime`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type QuarantineEventStatus = 'quarantined' | 'released' | 'discarded'

export type QuarantineEventItem = {
  id: number
  stream_id: number
  quarantine_reason: string
  quarantine_source: string
  status: QuarantineEventStatus
  event_count: number
  created_at: string
  updated_at: string
  released_at: string | null
  released_by: string | null
}

export type StreamQuarantineEventsResponse = {
  stream_id: number
  events: QuarantineEventItem[]
  event_count: number
}

export type StreamQuarantineSummaryResponse = {
  stream_id: number
  quarantined_count: number
  released_count: number
  discarded_count: number
  total_count: number
  last_released_at: string | null
}

export type QuarantineEventActionResponse = {
  id: number
  stream_id: number
  status: QuarantineEventStatus
  quarantine_reason: string
  quarantine_source: string
  outcome: string
  message: string
  checkpoint_updated?: boolean
}

export async function fetchStreamQuarantineEvents(
  streamId: number,
  status?: QuarantineEventStatus,
  limit = 50,
): Promise<StreamQuarantineEventsResponse | null> {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  q.set('limit', String(limit))
  const qs = q.toString()
  return safeRequestJson<StreamQuarantineEventsResponse>(
    `${RT}/streams/${streamId}/quarantine-events?${qs}`,
    readJsonOpts,
  )
}

export async function fetchStreamQuarantineSummary(
  streamId: number,
  options?: GdcSignalOptions,
): Promise<StreamQuarantineSummaryResponse | null> {
  return safeRequestJson<StreamQuarantineSummaryResponse>(
    `${RT}/streams/${streamId}/quarantine/summary`,
    readJsonWithSignal(readJsonOpts, options?.signal),
  )
}

export async function releaseStreamQuarantineEvent(
  eventId: number,
): Promise<QuarantineEventActionResponse> {
  return requestJson<QuarantineEventActionResponse>(`${RT}/quarantine-events/${eventId}/release`, {
    method: 'POST',
  })
}

export async function discardStreamQuarantineEvent(
  eventId: number,
): Promise<QuarantineEventActionResponse> {
  return requestJson<QuarantineEventActionResponse>(`${RT}/quarantine-events/${eventId}/discard`, {
    method: 'POST',
  })
}
