import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConnectorCatalogPage } from './connector-catalog-page'
import type { ConnectorRegistryListRead } from '../../api/gdcConnectorsRegistry'

const sampleList: ConnectorRegistryListRead = {
  count: 1,
  connectors: [
    {
      id: 'crowdstrike',
      name: 'CrowdStrike Falcon',
      vendor: 'CrowdStrike',
      version: '1.0.0',
      source_type: 'HTTP_API_POLLING',
      auth_type: 'bearer',
      stream_count: 2,
      capabilities: { api_test: true },
      status: 'valid',
      migration_status: 'module_based',
      migration_label: 'Migrated',
      error_count: 0,
      migration_error_count: 0,
      resources: {
        streams_count: 2,
        mappings_count: 2,
        enrichments_count: 2,
        has_api_test: true,
        has_docs: true,
      },
    },
  ],
}

vi.mock('../../api/gdcConnectorsRegistry', () => ({
  fetchConnectorsRegistryList: vi.fn(async () => sampleList),
  fetchConnectorRegistryDetail: vi.fn(),
  fetchConnectorRegistryResources: vi.fn(),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectorCatalogPage />
    </MemoryRouter>,
  )
}

describe('ConnectorCatalogPage', () => {
  it('shows resource summary and valid status', async () => {
    renderPage()
    expect(await screen.findByTestId('connector-catalog-card-crowdstrike')).toBeInTheDocument()
    expect(screen.getByTestId('connector-status-valid')).toBeInTheDocument()
    expect(screen.getByTestId('connector-migration-crowdstrike')).toHaveTextContent('Module Based')
    expect(screen.getByTestId('connector-resources-streams-crowdstrike')).toHaveTextContent('2')
    expect(screen.getByTestId('connector-resources-mappings-crowdstrike')).toHaveTextContent('2')
    expect(screen.getByTestId('connector-resources-enrichments-crowdstrike')).toHaveTextContent('2')
    expect(screen.getByTestId('connector-resources-api-test-crowdstrike')).toHaveTextContent('Yes')
    expect(screen.getByTestId('connector-resources-docs-crowdstrike')).toHaveTextContent('Yes')
  })
})
