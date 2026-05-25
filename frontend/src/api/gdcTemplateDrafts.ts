import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type TemplateDraftImportSource = 'CURL' | 'POSTMAN' | 'API_TEST_SAMPLE'

export type TemplateDraftRequestStructure = {
  method: string
  base_url?: string | null
  endpoint?: string | null
  query_params?: Record<string, string>
  headers_masked?: Record<string, string>
  body?: unknown
  body_mode?: string | null
}

export type InferenceCandidate = {
  field_path?: string
  path?: string
  output_field?: string
  source_json_path?: string
  field_name?: string
  suggested_value?: string
  checkpoint_type?: string
  confidence: number
  reason: string
  sample_value?: unknown
  count?: number
  sample_item_preview?: unknown
}

export type TemplateDraftInference = {
  event_array_path?: string | null
  event_array_candidates?: InferenceCandidate[]
  timestamp_candidates?: InferenceCandidate[]
  checkpoint_candidates?: InferenceCandidate[]
  checkpoint_recommendation?: InferenceCandidate | null
  severity_candidates?: InferenceCandidate[]
  tenant_candidates?: InferenceCandidate[]
  mapping_candidates?: InferenceCandidate[]
  enrichment_candidates?: InferenceCandidate[]
  sample_event?: unknown
  normalized_event_preview?: Record<string, unknown> | null
}

export type TemplateDraftSummary = {
  id: string
  display_name: string
  vendor?: string | null
  product?: string | null
  use_case?: string | null
  source_type: string
  api_version?: string | null
  auth_type?: string | null
  import_source: TemplateDraftImportSource
  created_at: string
  updated_at: string
}

export type TemplateDraftDetail = TemplateDraftSummary & {
  description?: string | null
  api_family?: string | null
  request_structure: TemplateDraftRequestStructure
  inference: TemplateDraftInference
  mapping_candidate: InferenceCandidate[]
  enrichment_candidate: InferenceCandidate[]
  checkpoint_candidate?: InferenceCandidate | null
  sample_payload?: unknown
  metadata?: Record<string, unknown>
  connector_draft?: Record<string, unknown> | null
  stream_draft?: Record<string, unknown> | null
  normalized_event_preview?: Record<string, unknown> | null
}

export type TemplateDraftCreatePayload = {
  display_name: string
  description?: string | null
  vendor?: string | null
  product?: string | null
  use_case?: string | null
  source_type?: string
  api_family?: string | null
  api_version?: string | null
  auth_type?: string | null
  import_source: TemplateDraftImportSource
  request_structure: TemplateDraftRequestStructure
  sample_payload?: unknown
  approved_inference: TemplateDraftInference
  connector_draft?: Record<string, unknown> | null
  stream_draft?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export type TemplateDraftWizardPayload = {
  connector_draft: Record<string, unknown>
  stream_draft?: Record<string, unknown> | null
  redirect_hint?: string
}

const BASE = `${GDC_API_PREFIX}/templates/drafts`

export async function fetchTemplateDraftsList(): Promise<TemplateDraftSummary[]> {
  const raw = await safeRequestJson<unknown>(BASE)
  return Array.isArray(raw) ? (raw as TemplateDraftSummary[]) : []
}

export async function fetchTemplateDraftDetail(draftId: string): Promise<TemplateDraftDetail | null> {
  return safeRequestJson<TemplateDraftDetail>(`${BASE}/${encodeURIComponent(draftId)}`)
}

export async function previewTemplateDraftInference(payload: {
  sample_payload: unknown
  event_array_hint?: string | null
  vendor?: string | null
  product?: string | null
  source_type?: string
  approved_event_array_path?: string | null
  approved_mapping_candidates?: InferenceCandidate[] | null
}): Promise<TemplateDraftInference> {
  const res = await requestJson<{ inference: TemplateDraftInference }>(`${BASE}/preview-inference`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.inference
}

export async function createTemplateDraft(payload: TemplateDraftCreatePayload): Promise<TemplateDraftDetail> {
  return requestJson<TemplateDraftDetail>(BASE, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteTemplateDraft(draftId: string): Promise<void> {
  await requestJson<void>(`${BASE}/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
}

export async function cloneTemplateDraft(draftId: string): Promise<{ id: string; display_name: string }> {
  return requestJson<{ id: string; display_name: string }>(`${BASE}/${encodeURIComponent(draftId)}/clone`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function fetchTemplateDraftWizardPayload(draftId: string): Promise<TemplateDraftWizardPayload> {
  return requestJson<TemplateDraftWizardPayload>(`${BASE}/${encodeURIComponent(draftId)}/wizard-payload`)
}
