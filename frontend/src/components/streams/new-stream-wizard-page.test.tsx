import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { NewStreamWizardPage } from './new-stream-wizard-page'
import { StepMapping } from './wizard/step-mapping'
import { buildInitialState } from './wizard/wizard-state'

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

describe('NewStreamWizardPage legacy 9-step', () => {
  it('renders 9-step stepper labels', () => {
    localStorage.setItem('gdc-platform-persona', 'connector')

    render(
      <MemoryRouter initialEntries={['/streams/new']}>
        <NewStreamWizardPage />
      </MemoryRouter>,
    )

    const stepper = screen.getByTestId('wizard-stepper')
    expect(stepper.textContent).toContain('Connector')
    expect(stepper.textContent).toContain('HTTP Request')
    expect(stepper.textContent).toContain('API Test')
    expect(stepper.textContent).toContain('JSON Preview')
    expect(stepper.textContent).toContain('Mapping')
    expect(stepper.textContent).toContain('Enrichment')
    expect(stepper.textContent).toContain('Destinations')
    expect(stepper.textContent).toContain('Review')
    expect(stepper.textContent).toContain('Start Stream')
    expect(stepper.textContent).not.toContain('Data Policy')
    expect(stepper.textContent).not.toMatch(/\bConnect\b/)
  })

  it('shows connector step content without internal connect tabs', () => {
    localStorage.setItem('gdc-platform-persona', 'connector')

    render(
      <MemoryRouter initialEntries={['/streams/new']}>
        <NewStreamWizardPage />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('wizard-connect-tabs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-mapping-sections')).not.toBeInTheDocument()
  })

  it('StepMapping renders Basic, Advanced, and Expert tabs with wizard sample', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.parsedJson = { events: [{ id: 'evt-1', message: 'hello' }] }
    state.apiTest.extractedEvents = [{ id: 'evt-1', message: 'hello' }]
    state.apiTest.eventCount = 1
    state.apiTest.finishedAt = Date.now()
    state.stream.useWholeResponseAsEvent = true

    render(
      <StepMapping
        state={state}
        onChangeMapping={() => {}}
        transformRules={[]}
        onChangeTransformRules={() => {}}
      />,
    )

    expect(screen.getByRole('tab', { name: /Basic · JSONPath/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Advanced · JSONata/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Expert · Regex extract/i })).toBeInTheDocument()
  })
})
