import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { MetricsWindow } from './gdcRuntime'
import type { ObservabilitySummaryResponse } from './types/gdcApi'

const RT = `${GDC_API_PREFIX}/runtime`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export async function fetchObservabilitySummary(
  window: MetricsWindow = '24h',
  params: { snapshot_id?: string } = {},
): Promise<ObservabilitySummaryResponse | null> {
  const q = new URLSearchParams({ window })
  if (params.snapshot_id != null && params.snapshot_id.trim() !== '') q.set('snapshot_id', params.snapshot_id.trim())
  return safeRequestJson<ObservabilitySummaryResponse>(`${RT}/observability/summary?${q.toString()}`, readJsonOpts)
}

