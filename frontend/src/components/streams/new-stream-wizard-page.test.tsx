import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { NewStreamWizardPage } from './new-stream-wizard-page'

vi.mock('../../api/gdcStreams', () => ({
  createStream: vi.fn(),
}))

vi.mock('../../api/gdcRuntimeUi', () => ({
  saveStreamMappingUiConfigStrict: vi.fn(),
}))

vi.mock('../../api/gdcRoutes', () => ({
  createRoute: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', () => ({
  startRuntimeStream: vi.fn(),
}))

vi.mock('../../api/gdcCatalog', () => ({
  fetchCatalogSnapshot: vi.fn(async () => ({ connectors: [], sources: [], apiBacked: false })),
}))

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorsList: vi.fn(async () => []),
  fetchConnectorById: vi.fn(async () => null),
}))

vi.mock('../../api/gdcSources', () => ({
  fetchSourceById: vi.fn(async () => null),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

describe('NewStreamWizardPage M17.3', () => {
  it('renders Standard 4-step stepper labels', () => {
    localStorage.setItem('gdc-platform-persona', 'connector')
    localStorage.setItem('gdc-wizard-governance-modal-seen-v1', '1')

    render(
      <MemoryRouter initialEntries={['/streams/new']}>
        <NewStreamWizardPage />
      </MemoryRouter>,
    )

    const stepper = screen.getByTestId('wizard-stepper')
    expect(stepper.textContent).toContain('Connect')
    expect(stepper.textContent).toContain('Mapping')
    expect(stepper.textContent).toContain('Destination')
    expect(stepper.textContent).toContain('Review')
    expect(stepper.textContent).not.toContain('Data Policy')
  })

  it('shows Connect internal tabs on first step', () => {
    localStorage.setItem('gdc-platform-persona', 'connector')
    localStorage.setItem('gdc-wizard-governance-modal-seen-v1', '1')

    render(
      <MemoryRouter initialEntries={['/streams/new']}>
        <NewStreamWizardPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-connect-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-connection')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-api_test')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-preview')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-connect-tab-record_selection')).toBeInTheDocument()
  })

  it('offers Governance 5-step wizard when Governance Operator persona is active', async () => {
    localStorage.setItem('gdc-platform-persona', 'governance')
    localStorage.removeItem('gdc-wizard-governance-modal-seen-v1')

    render(
      <MemoryRouter initialEntries={['/streams/new']}>
        <NewStreamWizardPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-governance-start-modal')).toBeInTheDocument()
  })
})
