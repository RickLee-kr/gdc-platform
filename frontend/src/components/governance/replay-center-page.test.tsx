import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gdcGovernancePolicies from '../../api/gdcGovernancePolicies'
import * as gdcGovernanceReplay from '../../api/gdcGovernanceReplay'
import * as gdcDestinations from '../../api/gdcDestinations'
import * as gdcStreams from '../../api/gdcStreams'
import { PERSONA_STORAGE_KEY } from '../../utils/persona-mode'
import { persistTestSession } from '../../lib/governance-rbac'
import { ReplayCenterPage } from './replay-center-page'

const sampleEntry: gdcGovernanceReplay.GovernanceReplayEntry = {
  id: 7,
  policy_id: 1,
  policy_name: 'Customer PII Policy',
  stream_id: 10,
  stream_name: 'Malop API',
  route_id: 42,
  route_label: 'Route #42 → Webhook Dest',
  destination_id: 5,
  destination_name: 'Webhook Dest',
  status: 'PENDING',
  created_at: '2026-06-06T10:00:00Z',
  completed_at: null,
  last_replay_at: null,
  outcome: null,
  event_count: 1,
  correlation_id: 'q-42',
  failure_reason: 'destination unreachable',
  can_replay: true,
  blocking_reason: null,
}

const failedEntry: gdcGovernanceReplay.GovernanceReplayEntry = {
  ...sampleEntry,
  id: 8,
  status: 'FAILED',
  outcome: 'Failure',
  completed_at: '2026-06-06T11:00:00Z',
  last_replay_at: '2026-06-06T11:00:00Z',
}

const sampleDetail: gdcGovernanceReplay.GovernanceReplayDetailResponse = {
  entry: sampleEntry,
  policy_summary: {
    policy_id: 1,
    policy_name: 'Customer PII Policy',
    policy_status: 'ACTIVE',
    policy_version: 3,
  },
  route_context: {
    route_id: 42,
    route_label: 'Route #42 → Webhook Dest',
    destination_id: 5,
    destination_name: 'Webhook Dest',
    destination_type: 'WEBHOOK_POST',
  },
  correlation_id: 'q-42',
  source: {
    origin: 'Quarantine recovery',
    violation: { violation_id: 'q-42', status: 'QUARANTINED', reason: 'Response rule matched' },
    quarantine: {
      quarantine_event_id: 42,
      status: 'quarantined',
      quarantine_reason: 'policy:Customer PII Policy',
      created_at: '2026-06-06T09:00:00Z',
    },
  },
  timeline: [
    { step: 'replay_created', label: 'Replay created', event_time: '2026-06-06T10:00:00Z' },
  ],
  outcome: null,
  error_type: null,
  error_message: null,
  can_execute: true,
  blocking_reason: null,
  checkpoint_safe: true,
  last_replay_at: null,
}

function renderPage(initialEntries = ['/governance/replay']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ReplayCenterPage />
    </MemoryRouter>,
  )
}

describe('ReplayCenterPage', () => {
  beforeEach(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance')
    persistTestSession('GOVERNANCE_OPERATOR')
    vi.restoreAllMocks()
    vi.spyOn(gdcGovernancePolicies, 'fetchGovernancePolicies').mockResolvedValue({
      policies: [{ id: 1, name: 'Customer PII Policy' } as gdcGovernancePolicies.GovernancePolicyEntry],
    })
    vi.spyOn(gdcStreams, 'fetchStreamsList').mockResolvedValue([{ id: 10, name: 'Malop API' } as gdcStreams.StreamRead])
    vi.spyOn(gdcDestinations, 'fetchDestinationsList').mockResolvedValue([{ id: 5, name: 'Webhook Dest' } as gdcDestinations.DestinationListItem])
  })

  it('renders replay table', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      replay_events: [sampleEntry],
      queue_count: 1,
      failed_count: 0,
      recent_count: 0,
    })

    renderPage()

    expect(await screen.findByTestId('replay-center-page')).toBeInTheDocument()
    expect(await screen.findByTestId('replay-table')).toBeInTheDocument()
    expect(await screen.findByTestId('replay-row-7')).toBeInTheDocument()
    expect(screen.getByTestId('replay-row-7')).toHaveTextContent('Malop API')
    expect(screen.getByTestId('replay-row-7')).toHaveTextContent('PENDING')
    expect(screen.getByTestId('replay-row-route-7')).toHaveTextContent('Route #42')
    expect(screen.getByTestId('replay-row-failure-7')).toHaveTextContent('destination unreachable')
    expect(screen.getByTestId('replay-row-eligible-7')).toHaveTextContent('Yes')
  })

  it('shows empty state when no events', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 0,
      replay_events: [],
      queue_count: 0,
      failed_count: 0,
      recent_count: 0,
    })

    renderPage()

    expect(await screen.findByTestId('replay-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/No replay events found/i)).toBeInTheDocument()
  })

  it('opens detail drawer', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      replay_events: [sampleEntry],
      queue_count: 1,
      failed_count: 0,
      recent_count: 0,
    })
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayDetail').mockResolvedValue(sampleDetail)

    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('replay-row-7'))

    await waitFor(() => {
      expect(screen.getByTestId('replay-detail-drawer')).toBeInTheDocument()
    })
    expect(screen.getByTestId('replay-section-what-happened')).toBeInTheDocument()
    expect(screen.getByTestId('replay-audit-link')).toHaveTextContent('q-42')
    expect(screen.getByTestId('replay-action-execute')).toBeInTheDocument()
    expect(screen.getByTestId('replay-detail-route-context')).toHaveTextContent('Route #42')
    expect(screen.getByTestId('replay-detail-checkpoint-safe')).toBeInTheDocument()
  })

  it('bulk execute selected replays', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 2,
      replay_events: [sampleEntry, failedEntry],
      queue_count: 1,
      failed_count: 1,
      recent_count: 0,
    })
    const bulkSpy = vi.spyOn(gdcGovernanceReplay, 'bulkExecuteGovernanceReplay').mockResolvedValue({
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { id: 7, outcome: 'replayed', message: 'ok' },
        { id: 8, outcome: 'replayed', message: 'ok' },
      ],
    })

    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('replay-select-7'))
    await user.click(await screen.findByTestId('replay-select-8'))
    await user.click(await screen.findByTestId('replay-bulk-execute'))

    await waitFor(() => {
      expect(bulkSpy).toHaveBeenCalledWith([7, 8])
    })
  })

  it('shows connector read-only banner without bulk actions', async () => {
    persistTestSession('CONNECTOR_OPERATOR')
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      replay_events: [sampleEntry],
      queue_count: 1,
      failed_count: 0,
      recent_count: 0,
    })

    renderPage()

    expect(await screen.findByTestId('replay-read-only-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('replay-bulk-execute')).not.toBeInTheDocument()
    expect(screen.queryByTestId('replay-select-all')).not.toBeInTheDocument()
  })

  it('applies status filter from query param', async () => {
    const fetchSpy = vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue({
      window: '24h',
      total: 0,
      replay_events: [],
      queue_count: 0,
      failed_count: 0,
      recent_count: 0,
    })

    renderPage(['/governance/replay?status=FAILED'])

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
    })
    expect(await screen.findByTestId('replay-filter-status')).toHaveValue('FAILED')
  })
})
