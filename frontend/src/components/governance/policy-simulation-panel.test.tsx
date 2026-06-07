import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PolicyJsonBody } from '../../api/gdcGovernancePolicies'
import { PolicySimulationPanel } from './policy-simulation-panel'

const policyJson: PolicyJsonBody = {
  conditions: [{ field: 'classification', operator: 'equals', value: 'RESTRICTED' }],
  actions: [{ type: 'quarantine' }],
}

vi.mock('../../api/gdcGovernancePolicies', () => ({
  simulatePolicy: vi.fn(async () => ({
    events: [{ matched: true, actions: ['quarantine'], reason: 'classification equals RESTRICTED' }],
  })),
  simulateSavedPolicy: vi.fn(),
}))

describe('PolicySimulationPanel', () => {
  it('renders simulation panel and dry-run notice', () => {
    render(<PolicySimulationPanel policyJson={policyJson} />)
    expect(screen.getByTestId('policy-simulation-panel')).toBeInTheDocument()
    expect(screen.getByText(/Simulation \(Dry Run\)/i)).toBeInTheDocument()
    expect(screen.getByText(/does not deliver/i)).toBeInTheDocument()
    expect(screen.getByTestId('policy-simulation-run')).toBeInTheDocument()
  })

  it('shows matched simulation result', async () => {
    render(<PolicySimulationPanel policyJson={policyJson} />)
    fireEvent.click(screen.getByTestId('policy-simulation-run'))
    await waitFor(() => {
      expect(screen.getByTestId('policy-simulation-results')).toBeInTheDocument()
    })
    expect(screen.getByTestId('policy-simulation-result-matched')).toBeInTheDocument()
    expect(screen.getByText('Matched')).toBeInTheDocument()
    expect(screen.getByText(/Actions:/)).toBeInTheDocument()
    expect(screen.getByTestId('policy-simulation-result-matched')).toHaveTextContent('quarantine')
    expect(screen.getByText(/classification equals RESTRICTED/)).toBeInTheDocument()
  })

  it('shows unmatched simulation result', async () => {
    const { simulatePolicy } = await import('../../api/gdcGovernancePolicies')
    vi.mocked(simulatePolicy).mockResolvedValueOnce({
      events: [{ matched: false, actions: [], reason: 'Failed: classification equals RESTRICTED' }],
    })
    render(<PolicySimulationPanel policyJson={policyJson} />)
    fireEvent.click(screen.getByTestId('policy-simulation-run'))
    await waitFor(() => {
      expect(screen.getByTestId('policy-simulation-result-unmatched')).toBeInTheDocument()
    })
    expect(screen.getByText('Unmatched')).toBeInTheDocument()
  })

  it('shows validation error for invalid JSON', async () => {
    render(<PolicySimulationPanel policyJson={policyJson} />)
    const input = screen.getByTestId('policy-simulation-json-input')
    fireEvent.change(input, { target: { value: '{ invalid json' } })
    fireEvent.click(screen.getByTestId('policy-simulation-run'))
    expect(await screen.findByTestId('policy-simulation-validation-error')).toHaveTextContent(/Invalid JSON/i)
  })
})
