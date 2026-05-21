import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const RT = `${GDC_API_PREFIX}/runtime`

export type PipelineDebugRouteItem = {
  route_id: number
  destination_id: number
  destination_type: string
  formatter_summary: Record<string, unknown>
  delivery_preview: unknown
}

export type PipelineDebugResponse = {
  stream_id: number
  raw_event: Record<string, unknown> | null
  mapped_event: Record<string, unknown> | null
  enriched_event: Record<string, unknown> | null
  formatted_payload: string | null
  routes: PipelineDebugRouteItem[]
  warnings: string[]
  errors: string[]
}

export type PipelineDebugRequest = {
  raw_event?: Record<string, unknown> | unknown[] | null
}

export async function runStreamPipelineDebug(
  streamId: number,
  payload: PipelineDebugRequest = {},
): Promise<PipelineDebugResponse> {
  return requestJson<PipelineDebugResponse>(`${RT}/streams/${streamId}/pipeline-debug`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
