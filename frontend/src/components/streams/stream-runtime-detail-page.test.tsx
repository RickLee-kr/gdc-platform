import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamRuntimeDetailPage } from './stream-runtime-detail-page'
import { getUrl, jsonResponse } from '../../test/fetchMock'
import * as gdcRuntime from '../../api/gdcRuntime'
import * as gdcBackfill from '../../api/gdcBackfill'
import * as streamGovernanceSnapshot from '../../lib/stream-governance-snapshot'
import { persistStreamRuntimeMetricsAutoRefresh } from '../../localPreferences'

const { mockFetchStreamById } = vi.hoisted(() => ({
  mockFetchStreamById: vi.fn(async (id: number) => ({
    id,
    name: `Stream ${id}`,
    stream_type: 'HTTP_API_POLLING',
    connector_id: 1,
  })),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamById: mockFetchStreamById,
}))

vi.mock('../../api/gdcBackfill', () => ({
  replayStreamBackfill: vi.fn(),
}))

vi.mock('../../api/gdcRuntimePipelineDebug', () => ({
  runStreamPipelineDebug: vi.fn(async () => ({
    stream_id: 42,
    raw_event: null,
    mapped_event: null,
    enriched_event: null,
    formatted_payload: null,
    routes: [],
    warnings: [],
    errors: [],
  })),
}))

vi.mock('../../utils/mappingSourceSample', () => ({
  fetchMappingSourceSample: vi.fn(async () => ({
    ok: false,
    sourceType: 'HTTP_API_POLLING',
    rawPayload: null,
    treeDocument: {},
    unionSchema: null,
    extractedEvents: [],
    eventArrayPath: '',
    eventRootPath: '',
    sampleEventIndex: 0,
    message: 'No sample',
    recordsLabel: '—',
    fetchedAt: '',
  })),
}))

const emptyMetrics = {
  stream: {
    id: 42,
    name: 'Stream 42',
    status: 'RUNNING',
    last_run_at: null,
    last_success_at: null,
    last_error_at: null,
    last_checkpoint: null,
  },
  kpis: {
    events_last_hour: 0,
    delivered_last_hour: 0,
    failed_last_hour: 0,
    delivery_success_rate: 100,
    avg_latency_ms: 0,
    max_latency_ms: 0,
    error_rate: 0,
  },
  events_over_time: [] as [],
  route_health: [] as [],
  checkpoint_history: [] as [],
  recent_runs: [] as [],
  route_runtime: [] as [],
  recent_route_errors: [] as [],
}

function streamRuntimeMetricsFixture(params?: { snapshot_id?: string }) {
  const snapshot_id = params?.snapshot_id?.trim() || '2026-01-02T00:00:00Z'
  return {
    snapshot_id,
    generated_at: snapshot_id,
    stream: {
      id: 42,
      name: 'Stream 42',
      status: 'RUNNING',
      last_run_at: null,
      last_success_at: null,
      last_error_at: null,
      last_checkpoint: null,
    },
    kpis: {
      events_last_hour: 0,
      delivered_last_hour: 0,
      failed_last_hour: 0,
      delivery_success_rate: 100,
      avg_latency_ms: 0,
      max_latency_ms: 0,
      error_rate: 0,
    },
    events_over_time: [],
    route_health: [
      {
        route_id: 101,
        destination_name: 'Stellar Syslog',
        destination_type: 'SYSLOG_UDP',
        enabled: true,
        success_count: 1,
        failed_count: 0,
        last_success_at: null,
        last_failure_at: null,
        avg_latency_ms: 0,
        failure_policy: 'RETRY_AND_BACKOFF',
        last_error_message: null,
      },
    ],
    checkpoint_history: [],
    recent_runs: [],
    route_runtime: [],
    recent_route_errors: [],
  }
}

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamRuntimeTimeline: vi.fn(async () => null),
  fetchStreamRuntimeStats: vi.fn(async () => null),
  fetchStreamRuntimeHealth: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => ({ stats: null, health: null })),
  fetchStreamCheckpointHistory: vi.fn(async () => null),
  fetchStreamWebhookIngestObservability: vi.fn(async () => null),
  fetchStreamRuntimeMetrics: vi.fn(async (_id: number, _window: string, params?: { snapshot_id?: string }) =>
    streamRuntimeMetricsFixture(params),
  ),
  saveRuntimeRouteEnabledState: vi.fn(async () => null),
  runStreamOnce: vi.fn(async () => ({
    stream_id: 42,
    outcome: 'completed',
    message: null,
    extracted_event_count: 1,
    mapped_event_count: 1,
    enriched_event_count: 1,
    delivered_batch_event_count: 1,
    checkpoint_updated: true,
    transaction_committed: true,
  })),
  startRuntimeStream: vi.fn(async () => null),
  stopRuntimeStream: vi.fn(async () => null),
}))

function renderRuntimePage(streamId: string) {
  return render(
    <MemoryRouter initialEntries={[`/streams/${streamId}/runtime`]}>
      <Routes>
        <Route path="/streams/:streamId/runtime" element={<StreamRuntimeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StreamRuntimeDetailPage routes section', () => {
  it('shows connected destination fields for stream routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = getUrl(input)
        const path = url.split('?')[0]
        const pathname = path.startsWith('http')
          ? (() => {
              try {
                return new URL(path).pathname
              } catch {
                return path
              }
            })()
          : path
        if (pathname === '/api/v1/routes' || pathname === '/api/v1/routes/') {
          return jsonResponse([
            {
              id: 101,
              stream_id: 42,
              destination_id: 201,
              failure_policy: 'RETRY_AND_BACKOFF',
              enabled: true,
            },
          ])
        }
        if (pathname === '/api/v1/destinations' || pathname === '/api/v1/destinations/') {
          return jsonResponse([
            {
              id: 201,
              name: 'Stellar Syslog',
              destination_type: 'SYSLOG_UDP',
              config_json: { host: '192.168.1.10', port: 514, protocol: 'udp' },
              rate_limit_json: {},
              enabled: true,
              streams_using_count: 1,
              routes: [{ route_id: 101, stream_id: 42, stream_name: 'Stream 42' }],
            },
          ])
        }
        return jsonResponse({ items: [] })
      }),
    )

    const user = userEvent.setup()
    renderRuntimePage('42')

    await user.click(await screen.findByTestId('stream-detail-tab-audit'))
    expect(await screen.findByTestId('stream-runtime-health-extension')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Delivery paths · Operational/i })).toBeInTheDocument()
    expect(screen.getByText(/Committed delivery records · 1h aggregates/i)).toBeInTheDocument()
    expect(await screen.findByText('Stellar Syslog')).toBeInTheDocument()
    expect(screen.getByText(/SYSLOG_UDP/)).toBeInTheDocument()
    expect(screen.getByText('RETRY_AND_BACKOFF')).toBeInTheDocument()
    expect(screen.getByText('On')).toBeInTheDocument()
  })

  it('shows empty-state text when stream has no routes', async () => {
    vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mockImplementationOnce(
      async (_id, _window, params) => ({
        ...streamRuntimeMetricsFixture(params),
        route_health: [],
        route_runtime: [],
        stream: emptyMetrics.stream,
        kpis: emptyMetrics.kpis,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = getUrl(input)
        const path = url.split('?')[0]
        const pathname = path.startsWith('http')
          ? (() => {
              try {
                return new URL(path).pathname
              } catch {
                return path
              }
            })()
          : path
        if (pathname === '/api/v1/routes' || pathname === '/api/v1/routes/') return jsonResponse([])
        if (pathname === '/api/v1/destinations' || pathname === '/api/v1/destinations/') return jsonResponse([])
        return jsonResponse({ items: [] })
      }),
    )

    const user = userEvent.setup()
    renderRuntimePage('42')

    await user.click(await screen.findByTestId('stream-detail-tab-audit'))
    expect(await screen.findByText('No routes for this stream')).toBeInTheDocument()
    expect(screen.getByText(/Connect a destination from the stream workflow/i)).toBeInTheDocument()
  })
})

describe('StreamRuntimeDetailPage webhook receiver', () => {
  it('shows push ingest panel without checkpoint wording', async () => {
    mockFetchStreamById.mockResolvedValueOnce({
      id: 42,
      name: 'Webhook Stream',
      connector_id: 1,
      source_id: 1,
      stream_type: 'WEBHOOK_RECEIVER',
      status: 'RUNNING',
      enabled: true,
      polling_interval: 60,
    })
    vi.mocked(gdcRuntime.fetchStreamWebhookIngestObservability).mockResolvedValue({
      stream_id: 42,
      stream_status: 'RUNNING',
      source_enabled: true,
      stream_enabled: true,
      receiver_key: 'rx-42',
      receiver_path: '/api/v1/ingest/webhook/rx-42',
      webhook_auth_mode: 'no_auth',
      window: '1h',
      window_start: '2026-05-21T10:00:00Z',
      window_end: '2026-05-21T11:00:00Z',
      ingest_attempts: 2,
      successful_deliveries: 2,
      failed_deliveries: 0,
      auth_failures: 0,
      malformed_payload_count: 0,
      recent_ingest: { at: null, outcome: 'none', stage: null, message: null, run_id: null },
      recent_logs: [],
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = getUrl(input)
        const path = url.split('?')[0]
        const pathname = path.startsWith('http')
          ? (() => {
              try {
                return new URL(path).pathname
              } catch {
                return path
              }
            })()
          : path
        if (pathname === '/api/v1/routes' || pathname === '/api/v1/routes/') return jsonResponse([])
        if (pathname === '/api/v1/destinations' || pathname === '/api/v1/destinations/') return jsonResponse([])
        return jsonResponse({ items: [] })
      }),
    )

    const user = userEvent.setup()
    renderRuntimePage('42')
    await user.click(await screen.findByTestId('stream-detail-tab-audit'))
    expect(await screen.findByTestId('webhook-receiver-runtime-panel')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('webhook-metric-ingest-attempts')).toHaveTextContent('2')
    })
    expect(screen.queryByRole('heading', { name: /Checkpoint trace/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Last Checkpoint/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Checkpoint$/i })).not.toBeInTheDocument()
  })
})

describe('StreamRuntimeDetailPage backfill modal', () => {
  it('opens modal, runs replay, shows delivery summary', async () => {
    const user = userEvent.setup()
    vi.mocked(gdcBackfill.replayStreamBackfill).mockResolvedValue({
      id: 99,
      stream_id: 42,
      source_type: 'HTTP_API_POLLING',
      status: 'COMPLETED',
      backfill_mode: 'TIME_RANGE_REPLAY',
      requested_by: 'test',
      created_at: '2026-05-12T12:00:00Z',
      started_at: '2026-05-12T12:00:01Z',
      completed_at: '2026-05-12T12:00:02Z',
      failed_at: null,
      source_config_snapshot_json: {},
      checkpoint_snapshot_json: null,
      runtime_options_json: {},
      progress_json: {},
      error_summary: null,
      delivery_summary_json: { status: 'completed', sent: 2, failed: 0, skipped: 0 },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = getUrl(input)
        const path = url.split('?')[0]
        const pathname = path.startsWith('http')
          ? (() => {
              try {
                return new URL(path).pathname
              } catch {
                return path
              }
            })()
          : path
        if (pathname === '/api/v1/streams/42' || pathname.endsWith('/streams/42')) {
          return jsonResponse({
            id: 42,
            name: 'Stream 42',
            connector_id: 1,
            source_id: 1,
            stream_type: 'HTTP_API_POLLING',
            status: 'RUNNING',
            enabled: true,
            polling_interval: 60,
          })
        }
        if (pathname === '/api/v1/routes' || pathname === '/api/v1/routes/') {
          return jsonResponse([
            {
              id: 101,
              stream_id: 42,
              destination_id: 201,
              failure_policy: 'LOG_AND_CONTINUE',
              enabled: true,
            },
          ])
        }
        if (pathname === '/api/v1/destinations' || pathname === '/api/v1/destinations/') {
          return jsonResponse([
            {
              id: 201,
              name: 'Dest',
              destination_type: 'WEBHOOK_POST',
              config_json: { url: 'https://x.example/hook' },
              rate_limit_json: {},
              enabled: true,
              streams_using_count: 1,
              routes: [],
            },
          ])
        }
        return jsonResponse({ items: [] })
      }),
    )

    renderRuntimePage('42')
    await user.click(await screen.findByTestId('stream-detail-tab-audit'))

    await user.click(screen.getByTestId('stream-run-backfill-open'))
    expect(screen.getByTestId('stream-backfill-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('stream-backfill-submit'))
    expect(gdcBackfill.replayStreamBackfill).toHaveBeenCalled()
    expect(await screen.findByTestId('stream-backfill-result')).toBeInTheDocument()
    expect(screen.getByText('Sent').closest('li')).toHaveTextContent('2')
  })
})

describe('StreamRuntimeDetailPage M17.2 layout', () => {
  afterEach(() => {
    localStorage.removeItem('gdc-platform-persona')
  })

  it('hides governance drawer for Connector Operator persona (M17.4)', async () => {
    localStorage.setItem('gdc-platform-persona', 'connector')
    renderRuntimePage('42')
    await screen.findByTestId('stream-monitoring-status-strip')
    expect(screen.queryByTestId('stream-governance-drawer')).not.toBeInTheDocument()
  })

  it('shows status-first layout with governance drawer for Governance Operator', async () => {
    const user = userEvent.setup()
    localStorage.setItem('gdc-platform-persona', 'governance')
    renderRuntimePage('42')
    const statusStrip = await screen.findByTestId('stream-monitoring-status-strip')
    expect(statusStrip).toBeInTheDocument()
    expect(statusStrip).toHaveTextContent('Ingest Rate')
    expect(statusStrip).toHaveTextContent('Delivery Rate')
    expect(statusStrip).toHaveTextContent('Success Rate')
    expect(statusStrip).toHaveTextContent('Last Event')
    expect(screen.getByTestId('stream-flow-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('stream-recent-events-panel')).toBeInTheDocument()
    await user.click(screen.getByTestId('stream-detail-tab-audit'))
    expect(screen.getByTestId('stream-governance-drawer')).toBeInTheDocument()
    expect(screen.queryByTestId('schema-drift-panel')).not.toBeInTheDocument()
  })

  it('renders six-tab stream runtime shell', async () => {
    renderRuntimePage('42')
    expect(await screen.findByTestId('stream-detail-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-metrics')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-events')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-schema')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-violations')).toBeInTheDocument()
    expect(screen.getByTestId('stream-detail-tab-audit')).toBeInTheDocument()
    expect(screen.getByTestId('stream-recent-issues-panel')).toBeInTheDocument()
    expect(screen.getByTestId('stream-why-panel')).toBeInTheDocument()
    expect(screen.getByTestId('stream-information-panel')).toBeInTheDocument()
  })

  it('shows run history inside observability without placeholder tabs', async () => {
    const user = userEvent.setup()
    renderRuntimePage('42')
    await user.click(await screen.findByTestId('stream-detail-tab-audit'))
    expect(await screen.findByText('Run History')).toBeInTheDocument()
    expect(screen.getByTestId('stream-monitoring-observability')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configuration' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No additional tab-specific data/i)).not.toBeInTheDocument()
  })
})

describe('StreamRuntimeDetailPage lifecycle cleanup', () => {
  beforeEach(() => {
    mockFetchStreamById.mockImplementation(async (id: number) => ({
      id,
      name: `Stream ${id}`,
      stream_type: 'HTTP_API_POLLING',
      connector_id: 1,
    }))
    vi.mocked(gdcRuntime.fetchStreamRuntimeTimeline).mockResolvedValue(null)
    vi.mocked(gdcRuntime.fetchStreamRuntimeStatsHealth).mockResolvedValue({ stats: null, health: null })
    vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mockImplementation(
      async (_id, _window, params) => streamRuntimeMetricsFixture(params),
    )
    vi.spyOn(streamGovernanceSnapshot, 'fetchStreamGovernanceSnapshot').mockResolvedValue({
      schemaDrift: null,
      sensitive: null,
      protection: null,
      policy: null,
      dynamicRouting: null,
      failover: null,
      replay: null,
      quarantine: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    persistStreamRuntimeMetricsAutoRefresh(false)
  })

  it('runs initial runtime refresh once after stream metadata resolves', async () => {
    vi.mocked(gdcRuntime.fetchStreamRuntimeTimeline).mockClear()
    vi.mocked(gdcRuntime.fetchStreamRuntimeStatsHealth).mockClear()
    vi.mocked(gdcRuntime.fetchStreamRuntimeStats).mockClear()
    vi.mocked(gdcRuntime.fetchStreamRuntimeHealth).mockClear()

    renderRuntimePage('42')

    await waitFor(() => {
      expect(gdcRuntime.fetchStreamRuntimeTimeline).toHaveBeenCalledTimes(1)
    })
    expect(gdcRuntime.fetchStreamRuntimeStatsHealth).toHaveBeenCalledTimes(1)
    expect(gdcRuntime.fetchStreamRuntimeStats).not.toHaveBeenCalled()
    expect(gdcRuntime.fetchStreamRuntimeHealth).not.toHaveBeenCalled()
  })

  it('reuses refresh-cycle snapshot_id for stats-health and metrics', async () => {
    vi.mocked(gdcRuntime.fetchStreamRuntimeStatsHealth).mockClear()
    vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mockClear()

    renderRuntimePage('42')
    await waitFor(() => {
      expect(gdcRuntime.fetchStreamRuntimeStatsHealth).toHaveBeenCalledTimes(1)
      expect(gdcRuntime.fetchStreamRuntimeMetrics).toHaveBeenCalled()
    })

    const statsHealthSnapshot = vi.mocked(gdcRuntime.fetchStreamRuntimeStatsHealth).mock.calls[0]?.[3]?.snapshot_id
    const metricsSnapshot = vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mock.calls[0]?.[2]?.snapshot_id
    expect(statsHealthSnapshot).toBeTruthy()
    expect(metricsSnapshot).toBe(statsHealthSnapshot)
  })

  it('stops metrics auto-refresh polling after unmount', async () => {
    persistStreamRuntimeMetricsAutoRefresh(true)
    const { unmount } = renderRuntimePage('42')
    await waitFor(() => {
      expect(gdcRuntime.fetchStreamRuntimeMetrics).toHaveBeenCalled()
    })
    await screen.findByTestId('stream-monitoring-status-strip')
    const callsAfterMount = vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)
    unmount()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mock.calls.length).toBe(callsAfterMount)
  })

  it('skips stale refreshRuntimeData completion after unmount', async () => {
    let resolveTimeline!: (value: null) => void
    vi.mocked(gdcRuntime.fetchStreamRuntimeTimeline).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTimeline = resolve
        }),
    )
    vi.mocked(gdcRuntime.fetchStreamRuntimeMetrics).mockClear()
    const { unmount } = renderRuntimePage('42')
    await waitFor(() => {
      expect(gdcRuntime.fetchStreamRuntimeTimeline).toHaveBeenCalled()
    })
    unmount()
    resolveTimeline(null)
    await Promise.resolve()
    await Promise.resolve()
    expect(gdcRuntime.fetchStreamRuntimeMetrics).not.toHaveBeenCalled()
  })
})
