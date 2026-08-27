import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { SafeChangeEntityType, SafeChangePreviewResponse } from './gdcSafeChange'

const TBA = `${GDC_API_PREFIX}/runtime/test-before-apply`

export type TestBeforeApplyEvidence = {
  connection_ok?: boolean | null
  sample_fetched?: boolean | null
  validated?: boolean | null
  tested_at?: string | null
  notes?: string | null
}

export type TestBeforeApplyPreviewRequest = {
  entity_type: SafeChangeEntityType
  entity_id: number
  proposed: Record<string, unknown>
  base_updated_at?: string | null
  test_evidence?: TestBeforeApplyEvidence | null
}

export type TestBeforeApplyPreviewResponse = SafeChangePreviewResponse & {
  test: {
    status: 'PASS' | 'FAIL' | 'WARNING' | 'SKIPPED'
    summary: string
    checks: string[]
  }
}

export type TestBeforeApplyApplyResponse = {
  entity_type: SafeChangeEntityType
  entity_id: number
  applied: boolean
  no_op: boolean
  config_version: number | null
  updated_at: string | null
  preview: TestBeforeApplyPreviewResponse
}

export async function previewTestBeforeApply(
  payload: TestBeforeApplyPreviewRequest,
): Promise<TestBeforeApplyPreviewResponse> {
  return requestJson<TestBeforeApplyPreviewResponse>(`${TBA}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function applyTestBeforeApply(
  payload: TestBeforeApplyPreviewRequest,
): Promise<TestBeforeApplyApplyResponse> {
  return requestJson<TestBeforeApplyApplyResponse>(`${TBA}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
