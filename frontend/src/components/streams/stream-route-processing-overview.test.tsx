import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamRouteProcessingOverview } from './stream-route-processing-overview'

const fetchRoutesList = vi.fn()
const fetchDestinationsList = vi.fn()
const fetchRouteTransformEffective = vi.fn()
const fetchRouteProtectionEffective = vi.fn()
const fetchRouteClassificationEffective = vi.fn()
const fetchRoutePolicyEffective = vi.fn()

vi.mock('../../api/gdcRoutes', () => ({
  fetchRoutesList: (...args: unknown[]) => fetchRoutesList(...args),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: (...args: unknown[]) => fetchDestinationsList(...args),
}))

vi.mock('../../api/gdcRouteTransform', () => ({
  fetchRouteMappingUiConfig: vi.fn(async () => ({ inherit_stream_mapping: true, mapping: {} })),
  fetchRouteEnrichmentUiConfig: vi.fn(async () => ({ inherit_stream_enrichment: true, enrichment: {} })),
  fetchRouteTransformEffective: (...args: unknown[]) => fetchRouteTransformEffective(...args),
  saveRouteMappingUiConfig: vi.fn(),
  saveRouteEnrichmentUiConfig: vi.fn(),
}))

vi.mock('../../api/gdcRouteProtection', () => ({
  fetchRouteProtectionEffective: (...args: unknown[]) => fetchRouteProtectionEffective(...args),
  fetchRouteProtectionRules: vi.fn(async () => ({ route_id: 42, stream_id: 10, protection_enabled: true, rules: [], rule_count: 0 })),
  patchRouteProtectionRule: vi.fn(),
}))

vi.mock('../../api/gdcRouteClassification', () => ({
  fetchRouteClassificationEffective: (...args: unknown[]) => fetchRouteClassificationEffective(...args),
  fetchRouteClassificationRules: vi.fn(async () => ({ route_id: 42, stream_id: 10, rules: [], rule_count: 0 })),
  patchRouteClassificationRule: vi.fn(),
}))

vi.mock('../../api/gdcRoutePolicy', () => ({
  fetchRoutePolicyEffective: (...args: unknown[]) => fetchRoutePolicyEffective(...args),
  fetchRoutePolicyRules: vi.fn(async () => ({ route_id: 42, stream_id: 10, rules: [], rule_count: 0 })),
  patchRoutePolicyRule: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', () => ({
  searchRuntimeDeliveryLogs: vi.fn(async () => ({ logs: [] })),
}))

vi.mock('../../utils/mappingSourceSample', () => ({
  loadMappingWorkspaceContext: vi.fn(async () => null),
}))

vi.mock('../mappings/mapping-workspace', () => ({
  MappingWorkspace: () => <div data-testid="mapping-workspace-stub" />,
}))

function mockEffective(routeId: number) {
  fetchRouteTransformEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: 10,
    persisted_source: 'stream',
    mapping_source: 'stream',
    enrichment_source: 'stream',
    fallback_used: true,
    mapping_count: 1,
    enrichment_count: 0,
    processing_status: 'Inherited',
    message: 'ok',
  }))
  fetchRouteProtectionEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: 10,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 0,
    processing_status: 'Inherited',
    message: 'ok',
  }))
  fetchRouteClassificationEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: 10,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 0,
    processing_status: 'Overridden',
    message: 'ok',
  }))
  fetchRoutePolicyEffective.mockImplementation(async (id: number) => ({
    route_id: id,
    stream_id: 10,
    persisted_source: 'stream',
    fallback_used: true,
    rule_count: 0,
    processing_status: 'Mixed',
  }))
}

describe('StreamRouteProcessingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchRoutesList.mockResolvedValue([
      { id: 42, name: 'Route A', stream_id: 10, destination_id: 5, enabled: true },
      { id: 43, name: 'Route B', stream_id: 10, destination_id: 6, enabled: true },
      { id: 99, name: 'Other stream', stream_id: 20, destination_id: 5, enabled: true },
    ])
    fetchDestinationsList.mockResolvedValue([
      { id: 5, name: 'Dest A' },
      { id: 6, name: 'Dest B' },
    ])
    mockEffective(42)
  })

  it('renders global processing, routes table, and tabbed route detail', async () => {
    render(
      <MemoryRouter>
        <StreamRouteProcessingOverview streamId={10} />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('route-processing-overview')).toBeInTheDocument()
    expect(screen.getByTestId('stream-global-processing-section')).toBeInTheDocument()
    expect(await screen.findByTestId('route-processing-row-42')).toBeInTheDocument()
    expect(screen.getByTestId('route-processing-row-43')).toBeInTheDocument()
    expect(screen.queryByTestId('route-processing-row-99')).not.toBeInTheDocument()
    expect(screen.getByTestId('route-processing-transform-section')).toBeInTheDocument()
    expect(screen.getByTestId('stream-route-detail-tab-protection')).toBeInTheDocument()
    expect(screen.getByTestId('stream-route-detail-tab-classification')).toBeInTheDocument()
    expect(screen.getByTestId('stream-route-detail-tab-policy')).toBeInTheDocument()
    expect(screen.getByTestId('stream-route-inherit-transform')).toBeInTheDocument()
  })

  it('loads effective processing status for routes', async () => {
    render(
      <MemoryRouter>
        <StreamRouteProcessingOverview streamId={10} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(fetchRouteTransformEffective).toHaveBeenCalledWith(42)
      expect(fetchRouteClassificationEffective).toHaveBeenCalledWith(42)
      expect(fetchRoutePolicyEffective).toHaveBeenCalledWith(42)
    })
    const row42 = await screen.findByTestId('route-processing-row-42')
    expect(within(row42).getByText('Overridden')).toBeInTheDocument()
    expect(within(row42).getByText('Mixed')).toBeInTheDocument()
  })
})
