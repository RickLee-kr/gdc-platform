import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type AiStreamRead = {
  id: number
  stream_id: number
  provider_id: number
  slug: string
  model: string
  enabled: boolean
  created_at?: string | null
  updated_at?: string | null
}

export async function fetchAiStreamsList(): Promise<AiStreamRead[]> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/ai-streams/`, readJsonOpts)
  return Array.isArray(raw) ? (raw as AiStreamRead[]) : []
}
