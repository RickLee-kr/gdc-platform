import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const PROMO = `${GDC_API_PREFIX}/backup/promotion`

export type EnvironmentName = 'development' | 'staging' | 'production'
export type PromotionMode = 'additive' | 'full_restore'

export type PromotionIssue = {
  code: string
  message: string
  severity: 'blocking' | 'warning'
  path?: string | null
}

export type PromotionFieldChange = {
  entity_type: string
  entity_name: string
  path: string
  change: 'added' | 'removed' | 'modified'
  old?: unknown
  new?: unknown
}

export type PromotionPreviewResponse = {
  source_environment: EnvironmentName
  target_environment: EnvironmentName
  mode: PromotionMode
  target_fingerprint: string
  promotion_token: string
  has_changes: boolean
  changed_fields: PromotionFieldChange[]
  affected: {
    entities: Array<{
      entity_type: string
      id?: number | null
      name: string
      status?: string | null
      action: 'create' | 'compare' | 'replace'
    }>
    streams: number
    routes: number
    destinations: number
    connectors: number
  }
  blocking_issues: PromotionIssue[]
  warnings: PromotionIssue[]
  can_promote: boolean
  preview_only: boolean
  stale_target: boolean
  secrets_excluded: boolean
  checkpoints_excluded: boolean
  import_ok: boolean
  entity_counts: Record<string, number>
}

export type PromotionExportResponse = {
  source_environment: EnvironmentName
  bundle: Record<string, unknown>
  secrets_excluded: boolean
  checkpoints_excluded: boolean
  target_fingerprint: string
}

export type PromotionApplyResponse = {
  applied: boolean
  no_op: boolean
  source_environment: EnvironmentName
  target_environment: EnvironmentName
  mode: PromotionMode
  created_connector_ids: number[]
  created_stream_ids: number[]
  created_destination_ids: number[]
  redirect_path?: string | null
  preview: PromotionPreviewResponse
}

export async function exportPromotionBundle(payload: {
  source_environment: EnvironmentName
  include_destinations?: boolean
}): Promise<PromotionExportResponse> {
  return requestJson<PromotionExportResponse>(`${PROMO}/export`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function previewPromotion(payload: {
  source_environment: EnvironmentName
  target_environment: EnvironmentName
  bundle: unknown
  mode?: PromotionMode
  target_fingerprint?: string | null
}): Promise<PromotionPreviewResponse> {
  return requestJson<PromotionPreviewResponse>(`${PROMO}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function applyPromotion(payload: {
  source_environment: EnvironmentName
  target_environment: EnvironmentName
  bundle: unknown
  mode: PromotionMode
  promotion_token: string
  target_fingerprint: string
  confirm: boolean
  confirm_destructive?: boolean
}): Promise<PromotionApplyResponse> {
  return requestJson<PromotionApplyResponse>(`${PROMO}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
