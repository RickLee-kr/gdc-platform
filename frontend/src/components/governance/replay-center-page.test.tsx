import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gdcGovernancePolicies from '../../api/gdcGovernancePolicies'
import * as gdcGovernanceReplay from '../../api/gdcGovernanceReplay'
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
  status: 'PENDING',
  created_at: '2026-06-06T10:00:00Z',
  completed_at: null,
  outcome: null,
  event_count: 1,
  correlation_id: 'q-42',
}

const failedEntry: gdcGovernanceReplay.GovernanceReplayEntry = {
  ...sampleEntry,
  id: 8,
  status: 'FAILED',
  outcome: 'Failure',
  completed_at: '2026-06-06T11:00:00Z',
}

const completedEntry: gdcGovernanceReplay.GovernanceReplayEntry = {
  ...sampleEntry,
  id: 9,
  status: 'COMPLETED',
  outcome: 'Success',
  completed_at: '2026-06-06T12:00:00Z',
}

const sampleDetail: gdcGovernanceReplay.GovernanceReplayDetailResponse = {
  entry: sampleEntry,
  policy_summary: {
    policy_id: 1,
    policy_name: 'Customer PII Policy',
    policy_status: 'ACTIVE',
    policy_version: 3,
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
}

function listResponse(
  events: gdcGovernanceReplay.GovernanceReplayEntry[],
  extras?: Partial<gdcGovernanceReplay.GovernanceReplayListResponse>,
): gdcGovernanceReplay.GovernanceReplayListResponse {
  return {
    window: '24h',
    total: events.length,
    window_total: extras?.window_total ?? events.length,
    filtered_total: extras?.filtered_total ?? events.length,
    replay_events: events,
    queue_count: events.filter((e) => e.status === 'PENDING' || e.status === 'RUNNING').length,
    failed_count: events.filter((e) => e.status === 'FAILED').length,
    recent_count: events.filter((e) => e.status === 'COMPLETED').length,
    ...extras,
  }
}

function renderPage(initialEntries = ['/governance/replay']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ReplayCenterPage />
    </MemoryRouter>,
  )
}

vi.mock('../../lib/use-platform-environment', () => ({
  usePlatformEnvironment: () => ({
    appEnv: 'development',
    label: 'Development',
    loading: false,
    failed: false,
  }),
}))

describe('ReplayCenterPage', () => {
  beforeEach(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance')
    persistTestSession('GOVERNANCE_OPERATOR')
    vi.restoreAllMocks()
    vi.spyOn(gdcGovernancePolicies, 'fetchGovernancePolicies').mockResolvedValue({
      policies: [{ id: 1, name: 'Customer PII Policy' } as gdcGovernancePolicies.GovernancePolicyEntry],
    })
    vi.spyOn(gdcStreams, 'fetchStreamsList').mockResolvedValue([{ id: 10, name: 'Malop API' } as gdcStreams.StreamRead])
  })

  it('renders replay table', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(listResponse([sampleEntry]))

    renderPage()

    expect(await screen.findByTestId('replay-center-page')).toBeInTheDocument()
    expect(await screen.findByTestId('replay-table')).toBeInTheDocument()
    expect(await screen.findByTestId('replay-row-7')).toBeInTheDocument()
    expect(screen.getByTestId('replay-row-7')).toHaveTextContent('Malop API')
    expect(screen.getByTestId('replay-row-7')).toHaveTextContent('PENDING')
  })

  it('shows Total / Filtered / Loaded / Selected from API counts', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(
      listResponse([sampleEntry, failedEntry], { window_total: 12, filtered_total: 5 }),
    )

    renderPage()
    const user = userEvent.setup()

    expect(await screen.findByTestId('replay-row-7')).toBeInTheDocument()
    expect(screen.getByTestId('replay-count-total')).toHaveTextContent('Total (time window): 12')
    expect(screen.getByTestId('replay-count-filtered')).toHaveTextContent('Filtered: 5')
    expect(screen.getByTestId('replay-count-loaded')).toHaveTextContent('Loaded: 2')
    expect(screen.getByTestId('replay-count-selected')).toHaveTextContent('Selected: 0')

    await user.click(await screen.findByTestId('replay-select-7'))
    expect(screen.getByTestId('replay-count-selected')).toHaveTextContent('Selected: 1')
  })

  it('labels select-all as loaded scope and does not imply filtered-all', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(
      listResponse([sampleEntry, failedEntry, completedEntry], { window_total: 20, filtered_total: 20 }),
    )

    renderPage()
    const user = userEvent.setup()

    const selectAll = await screen.findByTestId('replay-select-all')
    expect(selectAll).toHaveAttribute('aria-label', 'Select loaded retryable')
    expect(await screen.findByTestId('replay-select-scope-hint')).toHaveTextContent(/Select loaded/i)
    expect(screen.getByTestId('replay-select-scope-hint')).toHaveTextContent(/full filtered result \(20\)/i)

    await user.click(selectAll)
    expect(screen.getByTestId('replay-count-selected')).toHaveTextContent('Selected: 2')
    expect(screen.queryByTestId('replay-select-9')).not.toBeInTheDocument()
    expect(screen.getByTestId('replay-select-7')).toBeChecked()
    expect(screen.getByTestId('replay-select-8')).toBeChecked()
  })

  it('prunes selection when refresh removes rows from the loaded list', async () => {
    const fetchSpy = vi
      .spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents')
      .mockResolvedValueOnce(listResponse([sampleEntry, failedEntry]))
      .mockResolvedValueOnce(listResponse([failedEntry]))

    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('replay-select-7'))
    await user.click(await screen.findByTestId('replay-select-8'))
    expect(screen.getByTestId('replay-count-selected')).toHaveTextContent('Selected: 2')

    await user.click(screen.getByTestId('replay-refresh'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('replay-count-selected')).toHaveTextContent('Selected: 1')
    })
    expect(screen.queryByTestId('replay-select-7')).not.toBeInTheDocument()
    expect(screen.getByTestId('replay-select-8')).toBeChecked()
  })

  it('shows empty state when no events', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(listResponse([]))

    renderPage()

    expect(await screen.findByTestId('replay-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/No replay events found/i)).toBeInTheDocument()
  })

  it('opens detail drawer', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(listResponse([sampleEntry]))
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
  })

  it('bulk execute selected replays with scoped dialog and result counts', async () => {
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(
      listResponse(
        [
          { ...sampleEntry, destination_name: 'SIEM A', route_id: 3 },
          { ...failedEntry, destination_name: 'SIEM A', route_id: 3 },
        ],
        { window_total: 2, filtered_total: 2 },
      ),
    )
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

    expect(await screen.findByTestId('replay-execute-confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText(/Selected count: 2/i)).toBeInTheDocument()
    expect(screen.getByText(/Stream count: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Route count: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Destination count: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Replay time window: 24h/i)).toBeInTheDocument()
    expect(screen.getByText(/Selection scope: currently loaded list/i)).toBeInTheDocument()
    expect(screen.getByText(/Destinations: SIEM A/i)).toBeInTheDocument()
    expect(screen.queryByText(/Total events in scope/i)).not.toBeInTheDocument()
    expect(bulkSpy).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('dangerous-action-confirm'))

    await waitFor(() => {
      expect(bulkSpy).toHaveBeenCalledWith([7, 8])
    })
    expect(await screen.findByTestId('replay-execution-result')).toBeInTheDocument()
    expect(screen.getByTestId('replay-result-requested')).toHaveTextContent('Requested: 2')
    expect(screen.getByTestId('replay-result-accepted')).toHaveTextContent('Accepted: 2')
    expect(screen.getByTestId('replay-result-failed')).toHaveTextContent('Failed: 0')
    expect(screen.queryByText(/Skipped:/i)).not.toBeInTheDocument()
  })

  it('shows connector read-only banner without bulk actions', async () => {
    persistTestSession('CONNECTOR_OPERATOR')
    vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(listResponse([sampleEntry]))

    renderPage()

    expect(await screen.findByTestId('replay-read-only-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('replay-bulk-execute')).not.toBeInTheDocument()
    expect(screen.queryByTestId('replay-select-all')).not.toBeInTheDocument()
  })

  it('applies status filter from query param', async () => {
    const fetchSpy = vi.spyOn(gdcGovernanceReplay, 'fetchGovernanceReplayEvents').mockResolvedValue(listResponse([]))

    renderPage(['/governance/replay?status=FAILED'])

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
    })
    expect(await screen.findByTestId('replay-filter-status')).toHaveValue('FAILED')
  })
})
