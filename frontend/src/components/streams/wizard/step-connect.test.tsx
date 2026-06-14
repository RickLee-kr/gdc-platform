import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepConnect } from './step-connect'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcCatalog', () => ({
  fetchCatalogSnapshot: vi.fn(async () => ({
    connectors: [{ id: 1, name: 'Test Connector', source_id: 1 }],
    sources: [],
    apiBacked: true,
  })),
}))

vi.mock('../../../api/gdcConnectorsRegistry', () => ({
  fetchConnectorsRegistryList: vi.fn(async () => ({ connectors: [] })),
}))

vi.mock('../../../api/gdcConnectors', () => ({
  fetchConnectorById: vi.fn(async () => null),
}))

describe('StepConnect UX simplification', () => {
  it('shows Connector, Request Configuration, and Advanced Settings tabs only', () => {
    render(
      <MemoryRouter>
        <StepConnect state={buildInitialState()} onConnectorChange={vi.fn()} onStreamChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-connect-tab-connector')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-request')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-advanced')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard-connect-tab-authentication')).not.toBeInTheDocument()
  })
})
