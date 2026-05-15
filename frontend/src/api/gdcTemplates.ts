import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { TemplateDetailRead, TemplateInstantiatePayload, TemplateInstantiateResponse, TemplateSummaryRead } from './types/gdcApi'

export async function fetchTemplatesList(): Promise<TemplateSummaryRead[]> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/templates/`)
  return Array.isArray(raw) ? (raw as TemplateSummaryRead[]) : []
}

export async function fetchTemplateDetail(templateId: string): Promise<TemplateDetailRead | null> {
  return safeRequestJson<TemplateDetailRead>(`${GDC_API_PREFIX}/templates/${encodeURIComponent(templateId)}`)
}

export async function instantiateTemplate(
  templateId: string,
  payload: TemplateInstantiatePayload,
): Promise<TemplateInstantiateResponse> {
  return requestJson<TemplateInstantiateResponse>(
    `${GDC_API_PREFIX}/templates/${encodeURIComponent(templateId)}/instantiate`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}
