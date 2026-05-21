import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type AuditLogItemDto = {
  id: number
  created_at: string
  actor_user_id: number | null
  actor_username: string | null
  action: string
  entity_type: string | null
  entity_id: number | null
  result: string
  ip_address: string | null
  user_agent: string | null
  metadata_json: Record<string, unknown>
  summary: string | null
}

export type AuditLogListDto = {
  total: number
  items: AuditLogItemDto[]
}

export type AuditLogQuery = {
  action?: string
  entity_type?: string
  result?: string
  since?: string
  limit?: number
  offset?: number
}

export async function listAuditLogs(params?: AuditLogQuery): Promise<AuditLogListDto> {
  const q = new URLSearchParams()
  if (params?.action) q.set('action', params.action)
  if (params?.entity_type) q.set('entity_type', params.entity_type)
  if (params?.result) q.set('result', params.result)
  if (params?.since) q.set('since', params.since)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return requestJson<AuditLogListDto>(`${GDC_API_PREFIX}/audit-logs${suffix}`)
}
