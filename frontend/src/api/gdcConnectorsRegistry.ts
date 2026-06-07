import { safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

export type ConnectorResourcesSummaryRead = {
  streams_count: number
  mappings_count: number
  enrichments_count: number
  has_api_test: boolean
  has_docs: boolean
}

export type MigrationStatusRead = 'module_based' | 'legacy' | 'migration_pending'

export type ConnectorRegistrySummaryRead = {
  id: string
  name: string
  vendor: string
  version: string
  source_type: string
  auth_type: string
  stream_count: number
  capabilities: Record<string, unknown>
  status: 'valid' | 'invalid'
  migration_status: MigrationStatusRead
  migration_label: string
  legacy_template_id?: string | null
  error_count: number
  migration_error_count: number
  resources: ConnectorResourcesSummaryRead
}

export type ConnectorRegistryListRead = {
  connectors: ConnectorRegistrySummaryRead[]
  count: number
  migration_matrix?: Array<Record<string, string>>
}

export type ConnectorValidationErrorRead = {
  rule_id: string
  message: string
  path?: string | null
}

export type DocsMetadataRead = {
  path: string
  title?: string | null
  summary?: string | null
  line_count: number
}

export type ResolvedConnectorRead = {
  id: string
  name: string
  vendor: string
  version: string
  source_type: string
  auth: Record<string, unknown>
  auth_schema: Record<string, unknown> | null
  streams: Array<Record<string, unknown>>
  capabilities: Record<string, unknown>
  status: 'valid' | 'invalid'
  errors: ConnectorValidationErrorRead[]
  resources: ConnectorResourcesSummaryRead
  module_dir: string
  manifest_path: string
  manifest: Record<string, unknown> | null
}

export type ConnectorRegistryDetailRead = {
  id: string
  resolved: ResolvedConnectorRead
}

export type ConnectorRegistryResourcesRead = {
  id: string
  status: 'valid' | 'invalid'
  streams: Record<string, Record<string, unknown>>
  mappings: Record<string, Record<string, unknown>>
  enrichments: Record<string, Record<string, unknown>>
  api_test: Record<string, unknown> | null
  docs: DocsMetadataRead | null
  auth_schema: Record<string, unknown> | null
  resources: ConnectorResourcesSummaryRead
  errors: ConnectorValidationErrorRead[]
}

export async function fetchConnectorsRegistryList(): Promise<ConnectorRegistryListRead> {
  const raw = await safeRequestJson<ConnectorRegistryListRead>(`${GDC_API_PREFIX}/connectors-registry/`)
  if (!raw || !Array.isArray(raw.connectors)) {
    return { connectors: [], count: 0 }
  }
  return raw
}

export async function fetchConnectorRegistryDetail(connectorId: string): Promise<ConnectorRegistryDetailRead | null> {
  return safeRequestJson<ConnectorRegistryDetailRead>(
    `${GDC_API_PREFIX}/connectors-registry/${encodeURIComponent(connectorId)}`,
  )
}

export async function fetchConnectorRegistryResources(
  connectorId: string,
): Promise<ConnectorRegistryResourcesRead | null> {
  return safeRequestJson<ConnectorRegistryResourcesRead>(
    `${GDC_API_PREFIX}/connectors-registry/${encodeURIComponent(connectorId)}/resources`,
  )
}
