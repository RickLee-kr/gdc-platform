import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { WebhookReceiverRuntimePanel } from './webhook-receiver-runtime-panel'
import * as gdcRuntime from '../../api/gdcRuntime'

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamWebhookIngestObservability: vi.fn(),
}))

const basePayload = {
  stream_id: 7,
  stream_status: 'RUNNING',
  source_enabled: true,
  stream_enabled: true,
  receiver_key: 'rx-7',
  receiver_path: '/api/v1/ingest/webhook/rx-7',
  webhook_auth_mode: 'bearer_token',
  window: '1h',
  window_start: '2026-05-21T10:00:00Z',
  window_end: '2026-05-21T11:00:00Z',
  ingest_attempts: 3,
  successful_deliveries: 2,
  failed_deliveries: 1,
  auth_failures: 0,
  malformed_payload_count: 0,
  recent_ingest: {
    at: '2026-05-21T10:55:00Z',
    outcome: 'success' as const,
    stage: 'run_complete',
    message: 'ok',
    run_id: 'run-1',
  },
  recent_logs: [
    {
      id: 1,
      stage: 'run_started',
      level: 'INFO',
      status: 'started',
      message: 'started',
      route_id: null,
      destination_id: null,
      error_code: null,
      created_at: '2026-05-21T10:54:00Z',
    },
  ],
}

describe('WebhookReceiverRuntimePanel', () => {
  it('renders webhook ingest metrics and recent logs', async () => {
    vi.mocked(gdcRuntime.fetchStreamWebhookIngestObservability).mockResolvedValue(basePayload)
    render(
      <MemoryRouter>
        <WebhookReceiverRuntimePanel streamId={7} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('webhook-ingest-metrics')).toBeInTheDocument()
    })
    expect(screen.getByTestId('webhook-metric-ingest-attempts')).toHaveTextContent('3')
    expect(screen.getByTestId('webhook-metric-deliveries-ok')).toHaveTextContent('2')
    expect(screen.getByTestId('webhook-recent-logs')).toBeInTheDocument()
    expect(screen.getByText('/api/v1/ingest/webhook/rx-7')).toBeInTheDocument()
    expect(screen.getByText('Bearer token')).toBeInTheDocument()
    expect(screen.queryByText(/checkpoint/i)).not.toBeInTheDocument()
  })

  it('shows disabled receiver banner when source or stream is off', async () => {
    vi.mocked(gdcRuntime.fetchStreamWebhookIngestObservability).mockResolvedValue({
      ...basePayload,
      source_enabled: false,
      stream_enabled: true,
    })
    render(
      <MemoryRouter>
        <WebhookReceiverRuntimePanel streamId={7} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('webhook-receiver-disabled-banner')).toBeInTheDocument()
    })
  })
})
