import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchemaDrivenConnectionPanel } from './schema-driven-connection-panel'

vi.mock('../../../api/gdcConnectorsRegistry', () => ({
  fetchConnectorRegistryDetail: vi.fn(),
}))

import { fetchConnectorRegistryDetail } from '../../../api/gdcConnectorsRegistry'

const crowdstrikeDetail = {
  id: 'crowdstrike',
  resolved: {
    id: 'crowdstrike',
    name: 'CrowdStrike Falcon',
    vendor: 'CrowdStrike',
    version: '1.0.0',
    source_type: 'HTTP_API_POLLING',
    auth: { type: 'bearer' },
    auth_schema: {
      type: 'bearer',
      fields: [
        { name: 'base_url', label: 'API Base URL', required: true },
        { name: 'bearer_token', label: 'Bearer Token', required: true, secret: true },
      ],
    },
    streams: [],
    capabilities: {},
    status: 'valid' as const,
    errors: [],
    resources: {
      streams_count: 2,
      mappings_count: 2,
      enrichments_count: 2,
      has_api_test: true,
      has_docs: true,
    },
    module_dir: 'connectors/crowdstrike',
    manifest_path: 'connectors/crowdstrike/manifest.yaml',
    manifest: null,
  },
}

describe('SchemaDrivenConnectionPanel', () => {
  it('shows schema-driven form for a valid module', async () => {
    vi.mocked(fetchConnectorRegistryDetail).mockResolvedValueOnce(crowdstrikeDetail)
    render(
      <SchemaDrivenConnectionPanel
        moduleId="crowdstrike"
        values={{}}
        onValuesChange={() => {}}
        onConnectorPatch={() => {}}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('schema-driven-connection-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('schema-module-name')).toHaveTextContent('CrowdStrike Falcon')
    expect(screen.getByTestId('schema-field-bearer_token')).toBeInTheDocument()
  })

  it('shows read-only fallback when auth schema is missing', async () => {
    vi.mocked(fetchConnectorRegistryDetail).mockResolvedValueOnce({
      id: 'broken',
      resolved: {
        ...crowdstrikeDetail.resolved,
        id: 'broken',
        name: 'Broken Module',
        auth_schema: null,
      },
    })
    render(
      <SchemaDrivenConnectionPanel
        moduleId="broken"
        values={{}}
        onValuesChange={() => {}}
        onConnectorPatch={() => {}}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('schema-connection-fallback')).toBeInTheDocument()
    })
    expect(screen.getByText(/Schema unavailable/)).toBeInTheDocument()
  })
})
