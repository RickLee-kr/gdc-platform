import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepRouteProcessing } from './step-route-processing'
import { buildInitialState, DEFAULT_ROUTE_PROCESSING_INHERIT } from './wizard-state'

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
      inherit: { ...DEFAULT_ROUTE_PROCESSING_INHERIT },
    },
  ]
  return state
}

describe('StepRouteProcessing', () => {
  it('renders shared processing, route list, and route detail panel', async () => {
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
    expect(screen.getByTestId('shared-processing-section')).toBeInTheDocument()
    expect(screen.queryByText('Global Processing')).not.toBeInTheDocument()
    expect(screen.getByText('Shared Processing')).toBeInTheDocument()
    expect(screen.getByText(/Shared Processing is the default processing inherited by all routes/i)).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-shared-transform')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-list')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-detail-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('route-processing-list-card-r1')).toHaveTextContent('Syslog Primary')
    expect(screen.getByTestId('route-processing-list-card-r1')).toHaveTextContent('Destination-specific processing')
  })

  it('shows processing concern statuses and delivery on route card', async () => {
    const state = readyState()
    state.destinations.routeDrafts[0] = {
      ...state.destinations.routeDrafts[0]!,
      inherit: { transform: false, protection: true, classification: true, policy: false },
    }

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

    const card = await screen.findByTestId('route-processing-list-card-r1')
    expect(card).toHaveTextContent('Transform')
    expect(card).toHaveTextContent('Overridden')
    expect(card).toHaveTextContent('Inherited')
    expect(card).toHaveTextContent('Delivery')
    expect(screen.getByTestId('route-card-delivery-status')).toHaveTextContent('Enabled')
  })

  it('patches route draft when enabled is toggled in delivery tab', async () => {
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

    fireEvent.click(screen.getByTestId('route-detail-tab-delivery'))
    fireEvent.click(screen.getByTestId('route-processing-enabled-r1'))
    expect(onChangeDestinations).toHaveBeenCalledWith(
      expect.objectContaining({
        routeDrafts: [expect.objectContaining({ key: 'r1', enabled: false })],
      }),
    )
  })

  it('exposes failure policy and rate limit controls in delivery tab', async () => {
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

    fireEvent.click(screen.getByTestId('route-detail-tab-delivery'))
    expect(await screen.findByTestId('route-processing-failure-policy-r1')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-eps-r1')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-burst-r1')).toBeInTheDocument()
  })

  it('shows protection override status when route has field overrides', () => {
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

    const card = screen.getByTestId('route-processing-list-card-r1')
    expect(card).toHaveTextContent('Overridden')
  })
})
