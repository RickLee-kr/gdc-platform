import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GovernanceWorkspacePage } from './governance-workspace-page'

const fetchStreamsList = vi.fn()
const fetchRoutesList = vi.fn()
const fetchRouteTransformEffective = vi.fn()
const fetchRouteProtectionEffective = vi.fn()
const fetchRouteClassificationEffective = vi.fn()
const fetchRoutePolicyEffective = vi.fn()

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsList: (...args: unknown[]) => fetchStreamsList(...args),
}))

vi.mock('../../api/gdcRoutes', () => ({
  fetchRoutesList: (...args: unknown[]) => fetchRoutesList(...args),
}))

vi.mock('../../api/gdcRouteTransform', () => ({
  fetchRouteTransformEffective: (...args: unknown[]) => fetchRouteTransformEffective(...args),
}))

vi.mock('../../api/gdcRouteProtection', () => ({
  fetchRouteProtectionEffective: (...args: unknown[]) => fetchRouteProtectionEffective(...args),
}))

vi.mock('../../api/gdcRouteClassification', () => ({
  fetchRouteClassificationEffective: (...args: unknown[]) => fetchRouteClassificationEffective(...args),
}))

vi.mock('../../api/gdcRoutePolicy', () => ({
  fetchRoutePolicyEffective: (...args: unknown[]) => fetchRoutePolicyEffective(...args),
}))

function mockEffective(routeId: number, streamId: number) {
  fetchRouteTransformEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: streamId,
    persisted_source: 'stream',
    mapping_source: 'stream',
    enrichment_source: 'stream',
    fallback_used: true,
    mapping_count: 2,
    enrichment_count: 1,
    processing_status: id === 42 ? 'Inherited' : 'Overridden',
    message: 'ok',
  }))
  fetchRouteProtectionEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: streamId,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 3,
    processing_status: id === 42 ? 'Inherited' : 'Mixed',
    message: 'ok',
  }))
  fetchRouteClassificationEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: streamId,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 4,
    processing_status: 'Inherited',
    message: 'ok',
  }))
  fetchRoutePolicyEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: streamId,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 5,
    processing_status: 'Inherited',
  }))
}

describe('GovernanceWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchStreamsList.mockResolvedValue([
      { id: 10, name: 'Stream A', status: 'RUNNING' },
      { id: 20, name: 'Stream B', status: 'ERROR' },
    ])
    fetchRoutesList.mockResolvedValue([
      { id: 42, name: 'Route A', stream_id: 10, destination_id: 5, enabled: true },
      { id: 43, name: 'Route B', stream_id: 10, destination_id: 6, enabled: true },
      { id: 99, name: 'Other', stream_id: 20, destination_id: 5, enabled: true },
    ])
    mockEffective(42, 10)
  })

  it('renders three-panel layout with stream selection and route governance table', async () => {
    render(
      <MemoryRouter>
        <GovernanceWorkspacePage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('governance-workspace-page')).toBeInTheDocument()
    expect(screen.getByTestId('governance-workspace-streams-panel')).toBeInTheDocument()
    expect(screen.getByTestId('governance-workspace-summary-panel')).toBeInTheDocument()
    expect(screen.getByTestId('governance-workspace-routes-panel')).toBeInTheDocument()

    const row42 = await screen.findByTestId('governance-workspace-route-row-42')
    expect(within(row42).getAllByText('Inherited').length).toBeGreaterThan(0)
    expect(screen.getByTestId('governance-workspace-route-row-43')).toBeInTheDocument()
    expect(screen.queryByTestId('governance-workspace-route-row-99')).not.toBeInTheDocument()
  })

  it('updates summary and routes when another stream is selected', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <GovernanceWorkspacePage />
      </MemoryRouter>,
    )

    await screen.findByTestId('governance-workspace-stream-row-10')
    await user.click(within(screen.getByTestId('governance-workspace-stream-row-20')).getByRole('button'))
    await waitFor(() => {
      expect(screen.getByTestId('governance-workspace-route-row-99')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('governance-workspace-route-row-42')).not.toBeInTheDocument()
  })

  it('loads effective governance APIs for stream routes', async () => {
    render(
      <MemoryRouter>
        <GovernanceWorkspacePage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchRouteTransformEffective).toHaveBeenCalledWith(42)
      expect(fetchRouteProtectionEffective).toHaveBeenCalledWith(42)
      expect(fetchRouteClassificationEffective).toHaveBeenCalledWith(42)
      expect(fetchRoutePolicyEffective).toHaveBeenCalledWith(42)
    })
  })
})
