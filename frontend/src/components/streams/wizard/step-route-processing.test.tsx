import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepRouteProcessing } from './step-route-processing'
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

function readyState() {
  const state = buildInitialState()
  const finishedAt = Date.now()
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.parsedJson = { events: [{ id: 'evt-1', message: 'hello' }] }
  state.apiTest.extractedEvents = [{ id: 'evt-1', message: 'hello' }]
  state.apiTest.eventCount = 1
  state.apiTest.finishedAt = finishedAt
  state.stream.useWholeResponseAsEvent = true
  state.mapping = [{ id: 'm1', outputField: 'id', sourceJsonPath: '$.id' }]
  state.destinations.routeDrafts = [
    {
      key: 'r1',
      destinationId: 10,
      enabled: true,
      failurePolicy: 'RETRY_AND_BACKOFF',
      rateLimitJson: {},
    },
  ]
  return state
}

describe('StepRouteProcessing', () => {
  it('renders shared transform and route cards', async () => {
    render(
      <MemoryRouter>
        <StepRouteProcessing
          state={readyState()}
          onChangeMapping={() => {}}
          onChangeMappingMode={() => {}}
          onChangeFullEventJsonata={() => {}}
          onChangeFullEventRegexConfigJson={() => {}}
          onChangeEnrichment={() => {}}
          onChangeDataProtection={() => {}}
          onChangeDestinations={() => {}}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-step-route-processing')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-shared-transform')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-routes')).toBeInTheDocument()
    expect(await screen.findByText('Syslog Primary')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-card-r1')).toBeInTheDocument()
  })

  it('patches route draft when enabled is toggled', () => {
    const onChangeDestinations = vi.fn()
    render(
      <MemoryRouter>
        <StepRouteProcessing
          state={readyState()}
          onChangeMapping={() => {}}
          onChangeMappingMode={() => {}}
          onChangeFullEventJsonata={() => {}}
          onChangeFullEventRegexConfigJson={() => {}}
          onChangeEnrichment={() => {}}
          onChangeDataProtection={() => {}}
          onChangeDestinations={onChangeDestinations}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('route-processing-enabled-r1'))
    expect(onChangeDestinations).toHaveBeenCalledWith(
      expect.objectContaining({
        routeDrafts: [expect.objectContaining({ key: 'r1', enabled: false })],
      }),
    )
  })

  it('exposes failure policy and rate limit controls', async () => {
    render(
      <MemoryRouter>
        <StepRouteProcessing
          state={readyState()}
          onChangeMapping={() => {}}
          onChangeMappingMode={() => {}}
          onChangeFullEventJsonata={() => {}}
          onChangeFullEventRegexConfigJson={() => {}}
          onChangeEnrichment={() => {}}
          onChangeDataProtection={() => {}}
          onChangeDestinations={() => {}}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('route-processing-failure-policy-r1')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-eps-r1')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-burst-r1')).toBeInTheDocument()
  })

  it('shows protection override badge on route card footer', () => {
    const state = readyState()
    state.dataProtection.routeOverrides = [
      {
        key: 'o1',
        fieldPath: '$.email',
        routeDraftKey: 'r1',
        protectionAction: 'tokenize',
        deliveryBehavior: 'continue',
        enabled: true,
      },
      {
        key: 'o2',
        fieldPath: '$.password',
        routeDraftKey: 'r1',
        protectionAction: 'mask_full',
        deliveryBehavior: 'continue',
        enabled: true,
      },
    ]

    render(
      <MemoryRouter>
        <StepRouteProcessing
          state={state}
          onChangeMapping={() => {}}
          onChangeMappingMode={() => {}}
          onChangeFullEventJsonata={() => {}}
          onChangeFullEventRegexConfigJson={() => {}}
          onChangeEnrichment={() => {}}
          onChangeDataProtection={() => {}}
          onChangeDestinations={() => {}}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('route-processing-protection-footer-r1')).toHaveTextContent('Protection Overrides: 2')
  })
})
