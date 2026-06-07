import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as gdcRuntime from '../../api/gdcRuntime'
import { GOVERNANCE_LOG_DRILLDOWN_STAGES } from './delivery-log-stages'
import { LogsExplorerPage } from './logs-explorer-page'

vi.mock('../../api/gdcStreams', () => ({ fetchStreamsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcRoutes', () => ({ fetchRoutesList: vi.fn(async () => []) }))
vi.mock('../../api/gdcDestinations', () => ({ fetchDestinationsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcConnectors', () => ({ fetchConnectorsList: vi.fn(async () => []) }))
vi.mock('../../api/observabilitySummary', () => ({
  fetchObservabilitySummary: vi.fn(async (_window: string, params?: { snapshot_id?: string }) => ({
    snapshot_id: params?.snapshot_id ?? '2026-01-01T01:00:00Z',
    generated_at: params?.snapshot_id ?? '2026-01-01T01:00:00Z',
    window: '1h',
    window_start: '2026-01-01T00:00:00Z',
    window_end: '2026-01-01T01:00:00Z',
    metric_contract_version: 'v1',
    totals: {
      streams_total: 0,
      streams_running: 0,
      routes_total: 0,
      routes_enabled: 0,
      healthy_routes: 0,
      idle_routes: 0,
      unhealthy_routes: 0,
      delivery_success_events: 0,
      delivery_failed_events: 0,
      retry_success_events: 0,
      retry_failed_events: 0,
      runtime_telemetry_rows: 0,
      lifecycle_rows: 0,
      processed_events: 0,
      throughput_eps: 0,
      p95_latency_ms: null,
    },
    metric_contract: {},
    metric_meta: {},
  })),
}))

const sampleItem = {
  id: 99,
  created_at: '2026-06-05T10:00:00Z',
  level: 'INFO',
  stage: GOVERNANCE_LOG_DRILLDOWN_STAGES.classification,
  status: 'OK',
  message: 'classification complete',
  stream_id: 1,
  route_id: null,
  destination_id: null,
  connector_id: 1,
  run_id: 'run-abc',
  latency_ms: null,
  retry_count: 0,
  error_code: null,
  payload_sample: { classification_level: 'RESTRICTED' },
}

describe('LogsExplorerPage governance stage drill-down', () => {
  it('passes backend stage to API and renders returned rows (no client empty filter)', async () => {
    const fetchPage = vi.spyOn(gdcRuntime, 'fetchRuntimeLogsPage').mockResolvedValue({
      total_returned: 1,
      has_next: false,
      next_cursor_created_at: null,
      next_cursor_id: null,
      items: [sampleItem],
      snapshot_id: '2026-01-01T01:00:00Z',
      metric_meta: {},
    } as never)
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue({
      total_returned: 0,
      filters: {},
      logs: [],
      snapshot_id: '2026-01-01T01:00:00Z',
      metric_meta: {},
    } as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeLogsTotals').mockResolvedValue({
      metrics_window_seconds: 3600,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-01T01:00:00Z',
      total_rows: 1,
      error_rows: 0,
      warning_rows: 0,
      info_rows: 1,
      debug_rows: 0,
      snapshot_id: '2026-01-01T01:00:00Z',
      metric_meta: {},
    } as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeDashboardSummary').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={[`/logs?stage=${GOVERNANCE_LOG_DRILLDOWN_STAGES.classification}`]}>
        <LogsExplorerPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalled()
    })
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      stage: GOVERNANCE_LOG_DRILLDOWN_STAGES.classification,
    })

    expect(await screen.findByText(/classification complete/i)).toBeInTheDocument()

    const stageSelect = screen.getByLabelText(/Pipeline stage/i)
    expect(stageSelect).toHaveValue(GOVERNANCE_LOG_DRILLDOWN_STAGES.classification)

    fetchPage.mockRestore()
  })
})
