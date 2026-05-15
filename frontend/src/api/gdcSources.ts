import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type SourceRead = {
  id: number
  connector_id: number | null
  source_type: string | null
  config_json: Record<string, unknown> | null
  auth_json: Record<string, unknown> | null
  enabled: boolean | null
}

export type SourceWritePayload = {
  connector_id?: number | null
  source_type?: string | null
  config_json?: Record<string, unknown> | null
  auth_json?: Record<string, unknown> | null
  enabled?: boolean | null
}

export async function fetchSourcesList(): Promise<SourceRead[] | null> {
  return safeRequestJson<SourceRead[]>(`${GDC_API_PREFIX}/sources/`)
}

export async function createSource(payload: SourceWritePayload): Promise<SourceRead> {
  return requestJson<SourceRead>(`${GDC_API_PREFIX}/sources/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchSourceById(sourceId: number): Promise<SourceRead | null> {
  return safeRequestJson<SourceRead>(`${GDC_API_PREFIX}/sources/${sourceId}`)
}
