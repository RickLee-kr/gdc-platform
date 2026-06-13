import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepDeploy } from './step-deploy'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => [
    {
      id: 10,
      name: 'Syslog Primary',
      destination_type: 'SYSLOG_UDP',
      config_json: { host: '10.0.0.1', port: 514 },
      last_connectivity_test_success: true,
    },
  ]),
}))

vi.mock('../../../api/gdcRuntime', () => ({
  runStreamOnce: vi.fn(async () => ({ outcome: 'completed' })),
}))

function readyState() {
  const state = buildInitialState()
  const finishedAt = Date.now()
  state.connector.connectorId = 1
  state.connector.sourceId = 1
  state.connector.connectorName = 'Test Connector'
  state.stream.name = 'Test Stream'
  state.stream.endpoint = '/events'
  state.stream.eventArrayPath = '$.events'
  state.stream.checkpointSourcePath = '$.timestamp'
  state.stream.checkpointFieldType = 'datetime'
  state.stream.recordPathConfirmedForApiTestAt = finishedAt
  state.stream.checkpointConfirmedForApiTestAt = finishedAt
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.parsedJson = { events: [{ id: '1' }] }
  state.apiTest.finishedAt = finishedAt
  state.apiTest.eventCount = 2
  state.apiTest.extractedEvents = [{ id: '1' }]
  state.mapping = [{ id: 'm1', outputField: 'event_id', sourceJsonPath: '$.id' }]
  state.destinations.routeDrafts = [
    {
      key: 'r1',
      destinationId: 10,
      enabled: true,
      failurePolicy: 'RETRY_THEN_DLQ',
      rateLimitJson: '{}',
    },
  ]
  return state
}

describe('StepDeploy', () => {
  it('renders Deployment Decision Center with six checklist categories', () => {
    render(
      <MemoryRouter>
        <StepDeploy state={readyState()} onStart={vi.fn()} onNavigateToLegacySubstep={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-step-deploy')).toBeInTheDocument()
    expect(screen.getByText(/Deployment Decision Center/i)).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-connection')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-data')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-records')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-transform')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-protection')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-checklist-delivery')).toBeInTheDocument()
  })

  it('shows READY status when configuration is deployable', async () => {
    render(
      <MemoryRouter>
        <StepDeploy state={readyState()} onStart={vi.fn()} onNavigateToLegacySubstep={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('deploy-status-label')).toHaveTextContent('READY')
  })

  it('shows NEEDS ATTENTION for incomplete wizard state', () => {
    render(
      <MemoryRouter>
        <StepDeploy state={buildInitialState()} onStart={vi.fn()} onNavigateToLegacySubstep={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('deploy-status-label')).toHaveTextContent('NEEDS ATTENTION')
  })

  it('keeps configuration summary collapsed by default', () => {
    render(
      <MemoryRouter>
        <StepDeploy state={readyState()} onStart={vi.fn()} onNavigateToLegacySubstep={vi.fn()} />
      </MemoryRouter>,
    )

    const summary = screen.getByTestId('deploy-configuration-summary')
    expect(summary).toBeInTheDocument()
    expect(screen.queryByText('Template materialization')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration Summary' }))
    expect(summary.querySelector('dl')).toBeTruthy()
  })

  it('shows template materialization rows when expanded', () => {
    const state = readyState()
    state.connector.registryModuleId = 'crowdstrike'
    state.connector.selectedTemplateIds = ['detections', 'incidents']

    render(
      <MemoryRouter>
        <StepDeploy state={state} onStart={vi.fn()} onNavigateToLegacySubstep={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Configuration Summary' }))
    expect(screen.getByTestId('deploy-template-materialization')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-template-row-detections')).toBeInTheDocument()
    expect(screen.getByTestId('deploy-template-row-incidents')).toBeInTheDocument()
  })
})
