import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

export type DataFlowTroubleshootStageName =
  | 'source_fetch'
  | 'extraction'
  | 'transform'
  | 'protection'
  | 'classification'
  | 'policy'
  | 'destination'
  | 'checkpoint'
  | 'none'

export type DataFlowTroubleshootStage = {
  stage: DataFlowTroubleshootStageName
  status: 'ok' | 'attention' | 'problem'
  detail: string
}

export type DataFlowTroubleshootEvidenceRef = {
  kind: 'delivery_log' | 'circuit_breaker' | 'durable_queue' | 'checkpoint'
  id: number
  stage: string
  message: string
  created_at: string | null
  http_status: number | null
  error_code: string | null
}

export type DataFlowTroubleshootAction = {
  id: string
  label: string
  href_hint: string | null
}

export type DataFlowTroubleshootResponse = {
  stream_id: number
  stream_name: string
  stream_status: string
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'IDLE'
  current_issue: string
  diagnosis_stage: DataFlowTroubleshootStageName
  impact_events_pending: number
  impact_summary: string
  checkpoint_state: 'safe' | 'held' | 'unknown'
  checkpoint_detail: string
  recovery: string
  stages: DataFlowTroubleshootStage[]
  evidence: DataFlowTroubleshootEvidenceRef[]
  actions: DataFlowTroubleshootAction[]
  generated_at: string
  evidence_limit: number
}

export async function fetchStreamDataFlowTroubleshoot(
  streamId: number,
  limit = 100,
): Promise<DataFlowTroubleshootResponse> {
  const q = new URLSearchParams({ limit: String(limit) })
  return requestJson<DataFlowTroubleshootResponse>(
    `${RT}/streams/${streamId}/troubleshoot?${q.toString()}`,
  )
}
