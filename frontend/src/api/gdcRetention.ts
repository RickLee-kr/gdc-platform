import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'
import type {
  RetentionPreviewResponse,
  RetentionRunResponse,
  RetentionStatusResponse,
} from './types/gdcApi'

const BASE = `${GDC_API_PREFIX}/retention`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export async function fetchRetentionPreview(): Promise<RetentionPreviewResponse | null> {
  return safeRequestJson<RetentionPreviewResponse>(`${BASE}/preview`, readJsonOpts)
}

export async function fetchRetentionStatus(options?: GdcSignalOptions): Promise<RetentionStatusResponse | null> {
  return safeRequestJson<RetentionStatusResponse>(
    `${BASE}/status`,
    readJsonWithSignal(readJsonOpts, options?.signal),
  )
}

export async function postRetentionRun(body: {
  dry_run?: boolean
  tables?: string[] | null
}): Promise<RetentionRunResponse> {
  return requestJson<RetentionRunResponse>(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}
