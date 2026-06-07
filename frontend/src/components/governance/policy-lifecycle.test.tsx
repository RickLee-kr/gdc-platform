import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PolicyCatalogPage } from './policy-catalog-page'
import { PolicyEditorDrawer } from './policy-editor-drawer'
import type { GovernancePolicyEntry } from '../../api/gdcGovernancePolicies'
import { PERSONA_STORAGE_KEY } from '../../utils/persona-mode'

const basePolicy: GovernancePolicyEntry = {
  id: 1,
  name: 'Customer Data Protection',
  description: 'PII',
  category: 'DATA_PROTECTION',
  status: 'DRAFT',
  policy_json: {
    conditions: [{ field: 'classification', operator: 'equals', value: 'RESTRICTED' }],
    actions: [{ type: 'quarantine' }],
  },
  version: 1,
  assigned_stream_count: 0,
  assigned_stream_ids: [],
  created_at: '2026-06-05T12:00:00Z',
  updated_at: '2026-06-05T12:00:00Z',
}

const previewMock = {
  policy_id: 0,
  policy_json: basePolicy.policy_json,
  rules: [
    {
      condition_text: 'classification = RESTRICTED',
      action_text: 'quarantine',
      combined: 'IF classification = RESTRICTED THEN quarantine',
    },
  ],
  summary: 'IF classification = RESTRICTED THEN quarantine',
}

const impactMock = {
  window: '24h',
  total_events: 0,
  matched_events: 0,
  actions: {},
  streams: [],
  delta: { matched_events_change: null },
  data_available: false,
}

vi.mock('../../api/gdcGovernancePolicies', () => ({
  fetchGovernancePolicies: vi.fn(async () => ({ policies: [basePolicy] })),
  deleteGovernancePolicy: vi.fn(async () => true),
  createGovernancePolicy: vi.fn(),
  updateGovernancePolicy: vi.fn(),
  submitPolicyForReview: vi.fn(async () => ({ policy: { ...basePolicy, status: 'REVIEW' } })),
  activateGovernancePolicy: vi.fn(),
  retireGovernancePolicy: vi.fn(),
  fetchPolicyAssignments: vi.fn(async () => ({ policy_id: 1, assignments: [] })),
  updatePolicyAssignments: vi.fn(),
  fetchPolicyPreview: vi.fn(),
  previewPolicyJson: vi.fn(async () => previewMock),
  previewPolicyImpact: vi.fn(async () => impactMock),
  simulatePolicy: vi.fn(),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsList: vi.fn(async () => []),
}))

describe('Policy lifecycle UI', () => {
  beforeEach(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance')
  })

  it('renders status badge labels in catalog', async () => {
    render(
      <MemoryRouter>
        <PolicyCatalogPage />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('policy-status-badge-DRAFT')).toHaveTextContent('Draft')
  })

  it('shows submit for review lifecycle button on draft policy', async () => {
    render(<PolicyEditorDrawer open policy={basePolicy} onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByTestId('policy-editor-lifecycle')).toBeInTheDocument()
    expect(screen.getByTestId('policy-editor-status-badge')).toHaveTextContent('Draft')
    expect(screen.getByTestId('policy-lifecycle-submit-review')).toHaveTextContent('Submit for Review')
  })

  it('shows activate button on review policy', async () => {
    render(
      <PolicyEditorDrawer
        open
        policy={{ ...basePolicy, status: 'REVIEW' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByTestId('policy-lifecycle-activate')).toHaveTextContent('Activate')
    expect(screen.getByTestId('policy-editor-status-badge')).toHaveTextContent('Review')
  })

  it('shows retire button on active policy without save', async () => {
    render(
      <PolicyEditorDrawer
        open
        policy={{ ...basePolicy, status: 'ACTIVE' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByTestId('policy-lifecycle-retire')).toHaveTextContent('Retire')
    expect(screen.queryByTestId('policy-editor-save')).not.toBeInTheDocument()
  })

  it('retired policy is view-only with no lifecycle action', async () => {
    render(
      <PolicyEditorDrawer
        open
        policy={{ ...basePolicy, status: 'RETIRED' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByTestId('policy-editor-status-badge')).toHaveTextContent('Retired')
    expect(screen.getByText(/Retired policies are view-only/i)).toBeInTheDocument()
    expect(screen.queryByTestId('policy-lifecycle-submit-review')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-lifecycle-activate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-lifecycle-retire')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-editor-save')).not.toBeInTheDocument()
  })

  it('catalog delete only shown for retired policies', async () => {
    const { fetchGovernancePolicies } = await import('../../api/gdcGovernancePolicies')
    vi.mocked(fetchGovernancePolicies).mockResolvedValueOnce({
      policies: [
        basePolicy,
        { ...basePolicy, id: 2, name: 'Active Policy', status: 'ACTIVE' },
        { ...basePolicy, id: 3, name: 'Retired Policy', status: 'RETIRED' },
      ],
    })
    render(
      <MemoryRouter>
        <PolicyCatalogPage />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('policy-catalog-table')).toBeInTheDocument()
    expect(screen.queryByTestId('policy-catalog-delete-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('policy-catalog-delete-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('policy-catalog-delete-3')).toBeInTheDocument()
  })

  it('lifecycle submit for review calls API', async () => {
    const onSaved = vi.fn()
    const user = userEvent.setup()
    const { submitPolicyForReview } = await import('../../api/gdcGovernancePolicies')
    render(<PolicyEditorDrawer open policy={basePolicy} onClose={() => {}} onSaved={onSaved} />)
    await user.click(await screen.findByTestId('policy-lifecycle-submit-review'))
    expect(submitPolicyForReview).toHaveBeenCalledWith(1)
    expect(onSaved).toHaveBeenCalled()
  })
})
