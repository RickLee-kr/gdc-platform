import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataFlowTroubleshooterPanel } from './data-flow-troubleshooter-panel'

const fetchMock = vi.fn()

vi.mock('../../api/gdcRuntimeTroubleshoot', () => ({
  fetchStreamDataFlowTroubleshoot: (...args: unknown[]) => fetchMock(...args),
}))

describe('DataFlowTroubleshooterPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('renders diagnosis summary from API', async () => {
    fetchMock.mockResolvedValue({
      stream_id: 42,
      stream_name: 'CrowdStrike Alerts',
      stream_status: 'RUNNING',
      health: 'DEGRADED',
      current_issue: 'HTTP 503',
      diagnosis_stage: 'destination',
      impact_events_pending: 12481,
      impact_summary: '12,481 event(s) pending or delayed',
      checkpoint_state: 'held',
      checkpoint_detail: 'Checkpoint held — no confirmed data loss from this failure path',
      recovery: 'Circuit open — next probe scheduled when open window elapses',
      stages: [
        { stage: 'source_fetch', status: 'ok', detail: 'Last: run_started' },
        { stage: 'extraction', status: 'ok', detail: 'No recent evidence' },
        { stage: 'transform', status: 'ok', detail: 'No recent evidence' },
        { stage: 'protection', status: 'ok', detail: 'No recent evidence' },
        { stage: 'classification', status: 'ok', detail: 'No recent evidence' },
        { stage: 'policy', status: 'ok', detail: 'No recent evidence' },
        { stage: 'destination', status: 'problem', detail: 'HTTP 503' },
        { stage: 'checkpoint', status: 'attention', detail: 'Checkpoint held' },
      ],
      evidence: [
        {
          kind: 'delivery_log',
          id: 9,
          stage: 'route_send_failed',
          message: 'Destination returned HTTP 503',
          created_at: '2026-08-26T01:00:00Z',
          http_status: 503,
          error_code: 'DESTINATION_HTTP_ERROR',
        },
      ],
      actions: [
        { id: 'test_destination', label: 'Test Destination', href_hint: 'destination_detail' },
        { id: 'view_evidence', label: 'View Evidence', href_hint: 'delivery_logs' },
      ],
      generated_at: '2026-08-26T01:00:00Z',
      evidence_limit: 100,
    })

    render(
      <MemoryRouter>
        <DataFlowTroubleshooterPanel streamId={42} streamPathId="42" />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('data-flow-troubleshooter-panel')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('dft-current-issue')).toHaveTextContent('HTTP 503'))
    expect(screen.getByTestId('dft-stage')).toHaveTextContent('Destination')
    expect(screen.getByTestId('dft-impact')).toHaveTextContent('12,481')
    expect(screen.getByTestId('dft-checkpoint')).toHaveTextContent('Held')
    expect(screen.getByTestId('dft-recovery')).toHaveTextContent('Circuit open')
    expect(screen.getByTestId('dft-stage-destination')).toHaveTextContent('HTTP 503')
    expect(screen.getByTestId('dft-evidence')).toHaveTextContent('DESTINATION_HTTP_ERROR')
  })

  it('shows error and allows refresh', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({
      stream_id: 1,
      stream_name: 's',
      stream_status: 'RUNNING',
      health: 'IDLE',
      current_issue: 'No active delivery problem detected',
      diagnosis_stage: 'none',
      impact_events_pending: 0,
      impact_summary: 'No delayed queue backlog',
      checkpoint_state: 'safe',
      checkpoint_detail: 'Checkpoint unchanged',
      recovery: 'None required',
      stages: [],
      evidence: [],
      actions: [{ id: 'view_evidence', label: 'View Evidence', href_hint: 'delivery_logs' }],
      generated_at: '2026-08-26T01:00:00Z',
      evidence_limit: 100,
    })

    render(
      <MemoryRouter>
        <DataFlowTroubleshooterPanel streamId={1} />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('data-flow-troubleshooter-error')).toHaveTextContent('network down')
    await user.click(screen.getByTestId('data-flow-troubleshooter-refresh'))
    await waitFor(() => expect(screen.getByTestId('dft-current-issue')).toHaveTextContent('No active delivery problem'))
  })
})
