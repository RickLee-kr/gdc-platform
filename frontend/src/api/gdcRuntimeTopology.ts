import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { HealthScoringMode, RuntimeTopologyResponse } from './types/gdcApi'
import type { HealthWindowToken } from './gdcRuntimeHealth'

const BASE = `${GDC_API_PREFIX}/runtime/topology`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type TopologyQueryParams = {
  window?: HealthWindowToken
  scoring_mode?: HealthScoringMode
  snapshot_id?: string
}

function buildSearchParams(p: TopologyQueryParams): URLSearchParams {
  const q = new URLSearchParams()
  if (p.window != null) q.set('window', p.window)
  if (p.scoring_mode != null) q.set('scoring_mode', p.scoring_mode)
  if (p.snapshot_id != null && p.snapshot_id.trim() !== '') q.set('snapshot_id', p.snapshot_id.trim())
  return q
}

export async function fetchRuntimeTopology(
  params: TopologyQueryParams = {},
): Promise<RuntimeTopologyResponse | null> {
  const q = buildSearchParams(params)
  const qs = q.toString()
  return safeRequestJson<RuntimeTopologyResponse>(qs ? `${BASE}?${qs}` : BASE, readJsonOpts)
}
