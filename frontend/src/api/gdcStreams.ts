import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { StreamRead } from './types/gdcApi'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

/** Legacy placeholder shape from `app/streams/router` before DB-backed list. */
export function isStreamsPlaceholderResponse(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return true
  if (Array.isArray(body)) return false
  const o = body as Record<string, unknown>
  return typeof o.message === 'string' && !Array.isArray(o) && !('id' in o)
}

export async function fetchStreamsList(): Promise<StreamRead[] | null> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/streams/`, readJsonOpts)
  if (raw === null) return null
  if (isStreamsPlaceholderResponse(raw)) return null
  if (!Array.isArray(raw)) return null
  const out: StreamRead[] = []
  for (const row of raw) {
    if (row && typeof row === 'object' && 'id' in row && typeof (row as StreamRead).id === 'number') {
      out.push(row as StreamRead)
    }
  }
  return out.length ? out : null
}

export type StreamWritePayload = {
  name?: string | null
  connector_id?: number | null
  source_id?: number | null
  stream_type?: string | null
  config_json?: Record<string, unknown> | null
  polling_interval?: number | null
  enabled?: boolean | null
  status?: string | null
  rate_limit_json?: Record<string, unknown> | null
}

export async function fetchStreamById(streamId: number): Promise<StreamRead | null> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/streams/${streamId}`, readJsonOpts)
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return null
  if (!('id' in raw) || typeof (raw as StreamRead).id !== 'number') return null
  return raw as StreamRead
}

export async function createStream(payload: StreamWritePayload): Promise<StreamRead> {
  return requestJson<StreamRead>(`${GDC_API_PREFIX}/streams/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateStream(streamId: number, payload: StreamWritePayload): Promise<StreamRead> {
  return requestJson<StreamRead>(`${GDC_API_PREFIX}/streams/${streamId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteStream(streamId: number): Promise<void> {
  await requestJson<unknown>(`${GDC_API_PREFIX}/streams/${streamId}`, {
    method: 'DELETE',
  })
}

/**
 * Best-effort connector/source candidate discovered from existing streams.
 *
 * Backend `POST /streams/` requires existing `connector_id` and `source_id`,
 * and the connectors/sources HTTP routers currently return placeholders, so
 * the wizard reuses any (connector_id, source_id) pair from the streams list.
 * Returns null when nothing usable is available — callers must then fall back
 * to local/mock save.
 */
export async function findConnectorSourceCandidate(): Promise<{ connector_id: number; source_id: number } | null> {
  const list = await fetchStreamsList()
  if (!list?.length) return null
  for (const row of list) {
    if (typeof row.connector_id === 'number' && typeof row.source_id === 'number') {
      return { connector_id: row.connector_id, source_id: row.source_id }
    }
  }
  return null
}
