import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gdcGovernanceAudit from '../../api/gdcGovernanceAudit'
import * as gdcGovernancePolicies from '../../api/gdcGovernancePolicies'
import * as gdcStreams from '../../api/gdcStreams'
import type { StreamRead } from '../../api/types/gdcApi'
import { PERSONA_STORAGE_KEY } from '../../hooks/use-persona-mode'
import { AuditTrailPage } from './audit-trail-page'

const sampleEvent: gdcGovernanceAudit.GovernanceAuditEntry = {
  event_time: '2026-06-06T10:00:00Z',
  policy_id: 1,
  policy_name: 'Customer Data Protection',
  stream_id: 10,
  stream_name: 'Malop API',
  event_type: 'QUARANTINE_CREATED',
  status: 'QUARANTINED',
  correlation_id: 'q-42',
}

const sampleDetail: gdcGovernanceAudit.GovernanceAuditDetailResponse = {
  correlation_id: 'q-42',
  policy_id: 1,
  policy_name: 'Customer Data Protection',
  stream_id: 10,
  stream_name: 'Malop API',
  current_status: 'DELIVERED',
  outcome: 'DELIVERED',
  timeline: [
    {
      event_time: '2026-06-06T10:00:00Z',
      event_type: 'VIOLATION_CREATED',
      summary: 'Violation detected',
      actor: 'System',
    },
    {
      event_time: '2026-06-06T10:00:00Z',
      event_type: 'QUARANTINE_CREATED',
      summary: 'Quarantined',
      actor: 'System',
    },
    {
      event_time: '2026-06-06T10:05:00Z',
      event_type: 'QUARANTINE_RELEASED',
      summary: 'Released',
      actor: 'operator@gdc',
    },
    {
      event_time: '2026-06-06T10:06:00Z',
      event_type: 'REPLAY_COMPLETED',
      summary: 'Replay completed',
      actor: 'operator@gdc',
    },
  ],
  related_violation: {
    violation_id: 'q-42',
    status: 'REPLAYED',
    reason: 'Response rule matched',
  },
  related_quarantine: {
    quarantine_event_id: 42,
    status: 'released',
  },
  related_replay: {
    replay_event_id: 7,
    status: 'replayed',
    event_count: 2,
  },
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditTrailPage />
    </MemoryRouter>,
  )
}

describe('AuditTrailPage', () => {
  beforeEach(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance')
    vi.spyOn(gdcGovernancePolicies, 'fetchGovernancePolicies').mockResolvedValue({
      policies: [{ id: 1, name: 'Customer Data Protection' } as gdcGovernancePolicies.GovernancePolicyEntry],
    })
    vi.spyOn(gdcStreams, 'fetchStreamsList').mockResolvedValue([
      { id: 10, name: 'Malop API' } as StreamRead,
    ])
  })

  it('renders audit table', async () => {
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      events: [sampleEvent],
    })

    renderPage()

    expect(await screen.findByTestId('audit-trail-page')).toBeInTheDocument()
    expect(await screen.findByTestId('audit-table')).toBeInTheDocument()
    const row = await screen.findByTestId('audit-row-q-42-QUARANTINE_CREATED')
    expect(row).toHaveTextContent('Malop API')
    expect(row).toHaveTextContent('q-42')
  })

  it('shows empty state when no events', async () => {
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditEvents').mockResolvedValue({
      window: '24h',
      total: 0,
      events: [],
    })

    renderPage()

    expect(await screen.findByTestId('audit-empty-state')).toBeInTheDocument()
    expect(screen.getByText('No governance audit events found')).toBeInTheDocument()
  })

  it('opens timeline drawer on row click', async () => {
    const user = userEvent.setup()
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      events: [sampleEvent],
    })
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditDetail').mockResolvedValue(sampleDetail)

    renderPage()
    await screen.findByTestId('audit-row-q-42-QUARANTINE_CREATED')
    await user.click(screen.getByTestId('audit-row-q-42-QUARANTINE_CREATED'))

    expect(await screen.findByTestId('audit-detail-drawer')).toBeInTheDocument()
    expect(await screen.findByTestId('audit-drawer-summary')).toBeInTheDocument()
    expect(screen.getByTestId('audit-drawer-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('audit-drawer-related')).toBeInTheDocument()
    expect(screen.getByTestId('audit-drawer-outcome')).toHaveTextContent('DELIVERED')
    expect(screen.getByText('Violation detected')).toBeInTheDocument()
    expect(screen.getByText('Replay completed')).toBeInTheDocument()
  })

  it('closes drawer', async () => {
    const user = userEvent.setup()
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditEvents').mockResolvedValue({
      window: '24h',
      total: 1,
      events: [sampleEvent],
    })
    vi.spyOn(gdcGovernanceAudit, 'fetchGovernanceAuditDetail').mockResolvedValue(sampleDetail)

    renderPage()
    await screen.findByTestId('audit-row-q-42-QUARANTINE_CREATED')
    await user.click(screen.getByTestId('audit-row-q-42-QUARANTINE_CREATED'))
    await screen.findByTestId('audit-detail-drawer')
    await user.click(screen.getByTestId('audit-detail-close'))

    await waitFor(() => {
      expect(screen.queryByTestId('audit-detail-drawer')).not.toBeInTheDocument()
    })
  })
})
