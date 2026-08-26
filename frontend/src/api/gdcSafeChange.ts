import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const SC = `${GDC_API_PREFIX}/runtime/safe-change`

export type SafeChangeEntityType =
  | 'STREAM_CONFIG'
  | 'ROUTE_CONFIG'
  | 'DESTINATION_CONFIG'
  | 'MAPPING_CONFIG'

export type SafeChangeIssue = {
  code: string
  message: string
  severity: 'blocking' | 'warning'
  path?: string | null
}

export type SafeChangeFieldChange = {
  path: string
  change: 'added' | 'removed' | 'modified'
  old?: unknown
  new?: unknown
}

export type SafeChangePreviewResponse = {
  entity_type: SafeChangeEntityType
  entity_id: number
  entity_name: string
  current_updated_at: string | null
  has_changes: boolean
  changed_fields: SafeChangeFieldChange[]
  affected: {
    streams: Array<{ id: number; name: string; status: string }>
    routes: Array<{ id: number; stream_id: number; destination_id: number; enabled: boolean }>
    destinations: Array<{ id: number; name: string }>
  }
  runtime_impact: string
  delivery_impact: string
  blocking_issues: SafeChangeIssue[]
  warnings: SafeChangeIssue[]
  can_apply: boolean
  recommended_actions: Array<{ id: string; label: string }>
  preview_only: boolean
  stale_base: boolean
}

export type SafeChangePreviewRequest = {
  entity_type: SafeChangeEntityType
  entity_id: number
  proposed: Record<string, unknown>
  base_updated_at?: string | null
}

export type SafeChangeApplyResponse = {
  entity_type: SafeChangeEntityType
  entity_id: number
  applied: boolean
  no_op: boolean
  config_version: number | null
  updated_at: string | null
  preview: SafeChangePreviewResponse
}

export async function previewSafeChange(
  payload: SafeChangePreviewRequest,
): Promise<SafeChangePreviewResponse> {
  return requestJson<SafeChangePreviewResponse>(`${SC}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function applySafeChange(
  payload: SafeChangePreviewRequest,
): Promise<SafeChangeApplyResponse> {
  return requestJson<SafeChangeApplyResponse>(`${SC}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
