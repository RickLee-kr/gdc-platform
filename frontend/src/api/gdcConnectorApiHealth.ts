import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type ConnectorApiFailureKind =
  | 'none'
  | 'authentication'
  | 'connectivity'
  | 'timeout'
  | 'rate_limit'
  | 'http_api'
  | 'runtime'
  | 'credential_expiration'

export type ConnectorApiHealthStatus = 'HEALTHY' | 'WARNING' | 'UNHEALTHY' | 'IDLE'

export type ConnectorApiHealthAction = {
  id: string
  label: string
  href_hint: string | null
}

export type ConnectorApiHealthEvidence = {
  kind: 'auth_check' | 'delivery_log' | 'credential' | 'stream_health'
  id: number
  stage: string
  message: string
  created_at: string | null
  http_status: number | null
  error_code: string | null
}

export type ConnectorApiHealthStreamRef = {
  stream_id: number
  stream_name: string
  status: string
  primary_issue: string | null
}

export type ConnectorApiHealthResponse = {
  connector_id: number
  connector_name: string
  connector_status: string
  health: ConnectorApiHealthStatus
  problem: string
  cause: string
  failure_kind: ConnectorApiFailureKind
  recommended_action: string
  last_success_at: string | null
  last_failure_at: string | null
  last_auth_check_at: string | null
  last_auth_check_status: 'success' | 'failed' | null
  last_auth_error: string | null
  credential_status: string | null
  credential_expires_at: string | null
  source_rate_limited_count: number
  source_fetch_failed_count: number
  affected_streams: ConnectorApiHealthStreamRef[]
  evidence: ConnectorApiHealthEvidence[]
  actions: ConnectorApiHealthAction[]
  generated_at: string
  evidence_limit: number
}

export async function fetchConnectorApiHealth(
  connectorId: number,
  limit = 100,
): Promise<ConnectorApiHealthResponse> {
  const q = new URLSearchParams({ limit: String(limit) })
  return requestJson<ConnectorApiHealthResponse>(
    `${GDC_API_PREFIX}/connectors/${connectorId}/api-health?${q.toString()}`,
  )
}
