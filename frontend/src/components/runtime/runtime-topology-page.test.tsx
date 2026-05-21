import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeTopologyPage } from './runtime-topology-page'
import type { RuntimeTopologyResponse } from '../../api/types/gdcApi'

const emptyTopology: RuntimeTopologyResponse = {
  time: { window: '24h', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z', snapshot_id: 'snap' },
  scoring_mode: 'current_runtime',
  summary: {
    connector_count: 0,
    source_count: 0,
    stream_count: 0,
    route_count: 0,
    destination_count: 0,
    streams_with_mapping: 0,
    streams_with_enrichment: 0,
    enabled_streams: 0,
    disabled_streams: 0,
    enabled_routes: 0,
    disabled_routes: 0,
  },
  connectors: [],
  sources: [],
  streams: [],
  routes: [],
  destinations: [],
}

const fanOutTopology: RuntimeTopologyResponse = {
  time: { window: '24h', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z', snapshot_id: 'snap' },
  scoring_mode: 'current_runtime',
  summary: {
    connector_count: 1,
    source_count: 1,
    stream_count: 1,
    route_count: 2,
    destination_count: 2,
    streams_with_mapping: 1,
    streams_with_enrichment: 0,
    enabled_streams: 1,
    disabled_streams: 0,
    enabled_routes: 1,
    disabled_routes: 1,
  },
  connectors: [{ id: 10, name: 'Acme connector', status: 'RUNNING', source_count: 1, stream_count: 1 }],
  sources: [{ id: 20, connector_id: 10, source_type: 'HTTP_API_POLLING', enabled: true, stream_count: 1 }],
  streams: [
    {
      stream_id: 30,
      stream_name: 'Alerts stream',
      connector_id: 10,
      source_id: 20,
      stream_type: 'HTTP_API_POLLING',
      enabled: true,
      status: 'RUNNING',
      has_mapping: true,
      has_enrichment: false,
      enrichment_enabled: false,
      route_count: 2,
      health_level: 'HEALTHY',
      health_score: 95,
      last_success_at: null,
      last_failure_at: null,
    },
  ],
  routes: [
    {
      route_id: 40,
      stream_id: 30,
      destination_id: 50,
      enabled: true,
      status: 'ENABLED',
      failure_policy: 'LOG_AND_CONTINUE',
      destination_name: 'Webhook A',
      destination_type: 'WEBHOOK_POST',
      destination_enabled: true,
      health_level: 'HEALTHY',
      health_score: 100,
      last_success_at: null,
      last_failure_at: null,
    },
    {
      route_id: 41,
      stream_id: 30,
      destination_id: 51,
      enabled: false,
      status: 'DISABLED',
      failure_policy: 'LOG_AND_CONTINUE',
      destination_name: 'Syslog B',
      destination_type: 'SYSLOG_TCP',
      destination_enabled: false,
      health_level: null,
      health_score: null,
      last_success_at: null,
      last_failure_at: null,
    },
  ],
  destinations: [
    {
      destination_id: 50,
      name: 'Webhook A',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      route_count: 1,
      health_level: 'HEALTHY',
      health_score: 100,
      last_success_at: null,
      last_failure_at: null,
    },
    {
      destination_id: 51,
      name: 'Syslog B',
      destination_type: 'SYSLOG_TCP',
      enabled: false,
      route_count: 1,
      health_level: null,
      health_score: null,
      last_success_at: null,
      last_failure_at: null,
    },
  ],
}

vi.mock('../../api/gdcRuntimeTopology', () => ({
  fetchRuntimeTopology: vi.fn(async () => emptyTopology),
}))

async function mockTopology(body: RuntimeTopologyResponse): Promise<void> {
  const mod = await import('../../api/gdcRuntimeTopology')
  vi.mocked(mod.fetchRuntimeTopology).mockResolvedValueOnce(body)
}

describe('RuntimeTopologyPage', () => {
  beforeEach(async () => {
    const mod = await import('../../api/gdcRuntimeTopology')
    vi.mocked(mod.fetchRuntimeTopology).mockReset()
    vi.mocked(mod.fetchRuntimeTopology).mockResolvedValue(emptyTopology)
  })

  it('renders empty state when no streams exist', async () => {
    render(
      <MemoryRouter>
        <RuntimeTopologyPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /Runtime topology/i })).toBeInTheDocument()
    expect(await screen.findByText(/No configured pipelines yet/i)).toBeInTheDocument()
  })

  it('renders source to stream linkage and route fan-out', async () => {
    await mockTopology(fanOutTopology)
    render(
      <MemoryRouter>
        <RuntimeTopologyPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Alerts stream')).toBeInTheDocument()
    expect(screen.getAllByText(/HTTP_API_POLLING/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Webhook A')).toBeInTheDocument()
    expect(screen.getByText('Syslog B')).toBeInTheDocument()
    expect(screen.getByText(/Routes \(2\)/i)).toBeInTheDocument()
  })

  it('shows disabled route and destination badges', async () => {
    await mockTopology(fanOutTopology)
    render(
      <MemoryRouter>
        <RuntimeTopologyPage />
      </MemoryRouter>,
    )
    await screen.findByText('Syslog B')
    const routeOff = screen.getAllByText('Route off')
    expect(routeOff.length).toBeGreaterThanOrEqual(1)
    const destOff = screen.getAllByText('Dest off')
    expect(destOff.length).toBeGreaterThanOrEqual(1)
  })
})
