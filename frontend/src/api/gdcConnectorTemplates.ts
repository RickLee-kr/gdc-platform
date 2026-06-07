import { requestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type MaterializedStreamRead = {
  template_id: string
  stream_id: number
  stream_name: string
  mapping_id: number
  enrichment_id: number
  checkpoint_id: number
  stream_type: string
  enabled: boolean
  status: string
  config_json: Record<string, unknown>
  rate_limit_json: Record<string, unknown>
}

export type MaterializeResponse = {
  module_id: string
  connector_id: number
  created_streams: MaterializedStreamRead[]
}

export type MaterializeRequest = {
  connector_id: number
  module_id: string
  templates: string[]
}

export async function materializeConnectorTemplates(
  payload: MaterializeRequest,
): Promise<MaterializeResponse> {
  return requestJson<MaterializeResponse>(`${GDC_API_PREFIX}/connector-templates/materialize`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
