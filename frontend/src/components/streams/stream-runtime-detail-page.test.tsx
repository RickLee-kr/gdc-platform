import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamRuntimeDetailPage } from './stream-runtime-detail-page'
import { getUrl, jsonResponse } from '../../test/fetchMock'
import * as gdcRuntime from '../../api/gdcRuntime'
import * as gdcBackfill from '../../api/gdcBackfill'

vi.mock('../../api/gdcBackfill', () => ({
  replayStreamBackfill: vi.fn(),
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

    renderRuntimePage('42')

    expect(await screen.findByTestId('stream-runtime-health-extension')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Routes · Operational/i })).toBeInTheDocument()
    expect(screen.getByText(/Committed delivery_logs · 1h aggregates/i)).toBeInTheDocument()
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

    renderRuntimePage('42')

    expect(await screen.findByText('No routes for this stream')).toBeInTheDocument()
    expect(screen.getByText(/Connect a destination from the stream workflow/i)).toBeInTheDocument()
  })
})

describe('StreamRuntimeDetailPage webhook receiver', () => {
  it('shows push ingest panel without checkpoint wording', async () => {
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
        if (pathname === '/api/v1/streams/42' || pathname.endsWith('/streams/42')) {
          return jsonResponse({
            id: 42,
            name: 'Webhook Stream',
            connector_id: 1,
            source_id: 1,
            stream_type: 'WEBHOOK_RECEIVER',
            status: 'RUNNING',
            enabled: true,
            polling_interval: 60,
          })
        }
        if (pathname === '/api/v1/routes' || pathname === '/api/v1/routes/') return jsonResponse([])
        if (pathname === '/api/v1/destinations' || pathname === '/api/v1/destinations/') return jsonResponse([])
        return jsonResponse({ items: [] })
      }),
    )

    renderRuntimePage('42')
    expect(await screen.findByTestId('webhook-receiver-runtime-panel')).toBeInTheDocument()
    expect(screen.getByTestId('runtime-ingest-mode')).toHaveTextContent('Push ingest')
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
    await screen.findByTestId('stream-runtime-health-extension')

    await user.click(screen.getByTestId('stream-run-backfill-open'))
    expect(screen.getByTestId('stream-backfill-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('stream-backfill-submit'))
    expect(gdcBackfill.replayStreamBackfill).toHaveBeenCalled()
    expect(await screen.findByTestId('stream-backfill-result')).toBeInTheDocument()
    expect(screen.getByText('Sent').closest('li')).toHaveTextContent('2')
  })
})
