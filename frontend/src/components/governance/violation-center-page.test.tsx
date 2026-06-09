import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as gdcGovernanceViolations from '../../api/gdcGovernanceViolations'
import * as gdcGovernancePolicies from '../../api/gdcGovernancePolicies'
import { PERSONA_STORAGE_KEY } from '../../hooks/use-persona-mode'
import { ViolationCenterPage } from './violation-center-page'
import * as featureFlags from '../../lib/feature-flags'

const sampleViolation: gdcGovernanceViolations.GovernanceViolationEntry = {
  id: 'q-42',
  policy_id: 1,
  policy_name: 'Customer Data Protection',
  stream_id: 10,
  stream_name: 'Malop API',
  event_time: '2026-06-06T10:00:00Z',
  severity: 'HIGH',
  reason: 'Response rule matched: RESTRICTED Rule',
  status: 'QUARANTINED',
  quarantine_event_id: 42,
}

const sampleDetail: gdcGovernanceViolations.GovernanceViolationDetailResponse = {
  violation: sampleViolation,
  policy_summary: {
    policy_id: 1,
    policy_name: 'Customer Data Protection',
    policy_status: 'ACTIVE',
    policy_version: 3,
    rule_summary: 'IF classification = RESTRICTED THEN quarantine',
  },
  related_quarantine: {
    quarantine_event_id: 42,
    status: 'quarantined',
    quarantine_reason: 'policy:RESTRICTED Rule',
    created_at: '2026-06-06T10:00:00Z',
    released_at: null,
  },
  related_replays: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ViolationCenterPage />
    </MemoryRouter>,
  )
}

describe('ViolationCenterPage', () => {
  beforeEach(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance')
    vi.spyOn(gdcGovernancePolicies, 'fetchGovernancePolicies').mockResolvedValue({
      policies: [{ id: 1, name: 'Customer Data Protection' } as gdcGovernancePolicies.GovernancePolicyEntry],
    })
  })

  it('renders violation table', async () => {
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolations').mockResolvedValue({
      window: '24h',
      total: 1,
      violations: [sampleViolation],
    })

    renderPage()

    expect(await screen.findByTestId('violation-center-page')).toBeInTheDocument()
    expect(await screen.findByTestId('violation-table')).toBeInTheDocument()
    expect(await screen.findByTestId('violation-row-q-42')).toBeInTheDocument()
    expect(screen.getByText('Malop API')).toBeInTheDocument()
    expect(screen.getByTestId('violation-row-q-42')).toHaveTextContent('QUARANTINED')
  })

  it('shows empty state when no violations', async () => {
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolations').mockResolvedValue({
      window: '24h',
      total: 0,
      violations: [],
    })

    renderPage()

    expect(await screen.findByTestId('violation-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/No policy violations found/i)).toBeInTheDocument()
  })

  it('renders filters', async () => {
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolations').mockResolvedValue({
      window: '24h',
      total: 0,
      violations: [],
    })

    renderPage()

    expect(await screen.findByTestId('violation-filters')).toBeInTheDocument()
    expect(screen.getByTestId('violation-filter-window')).toBeInTheDocument()
    expect(screen.getByTestId('violation-filter-policy')).toBeInTheDocument()
    expect(screen.getByTestId('violation-filter-severity')).toBeInTheDocument()
    expect(screen.getByTestId('violation-filter-status')).toBeInTheDocument()
  })

  it('opens detail drawer on row click', async () => {
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolations').mockResolvedValue({
      window: '24h',
      total: 1,
      violations: [sampleViolation],
    })
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolationDetail').mockResolvedValue(sampleDetail)

    renderPage()
    const user = userEvent.setup()

    expect(await screen.findByTestId('violation-row-q-42')).toBeInTheDocument()
    await user.click(screen.getByTestId('violation-row-q-42'))

    await waitFor(() => {
      expect(screen.getByTestId('violation-detail-drawer')).toBeInTheDocument()
    })
    expect(screen.getByText(/IF classification = RESTRICTED THEN quarantine/i)).toBeInTheDocument()
    expect(screen.getByTestId('violation-open-quarantine')).toBeInTheDocument()
  })

  it('links policy to approvals in OSS mode instead of Data Protection', async () => {
    vi.spyOn(featureFlags, 'isOssReleaseMode').mockReturnValue(true)
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolations').mockResolvedValue({
      window: '24h',
      total: 1,
      violations: [sampleViolation],
    })
    vi.spyOn(gdcGovernanceViolations, 'fetchGovernanceViolationDetail').mockResolvedValue(sampleDetail)

    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('violation-row-q-42'))
    await waitFor(() => expect(screen.getByTestId('violation-detail-drawer')).toBeInTheDocument())
    const link = screen.getByTestId('violation-open-policy')
    expect(link).toHaveTextContent('View policy approvals')
    expect(link).toHaveAttribute('href', '/governance/approvals')
  })
})
