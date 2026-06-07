import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GovernancePolicyImpactResponse } from '../../api/gdcGovernancePolicies'
import { PolicyImpactPanel } from './policy-impact-panel'

const sampleImpact: GovernancePolicyImpactResponse = {
  window: '24h',
  total_events: 12482,
  matched_events: 1821,
  actions: { quarantine: 1821, tokenize: 4220, mask: 120 },
  streams: [
    { stream_id: 1, stream_name: 'CrowdStrike Detections', total_events: 5000, matched_events: 840 },
  ],
  delta: { matched_events_change: 320 },
  data_available: true,
}

describe('PolicyImpactPanel', () => {
  it('renders impact metrics and preview notice', () => {
    render(<PolicyImpactPanel impact={sampleImpact} />)
    expect(screen.getByTestId('policy-impact-panel')).toBeInTheDocument()
    expect(screen.getByText(/Preview only/i)).toBeInTheDocument()
    expect(screen.getByText(/Runtime enforcement not enabled/i)).toBeInTheDocument()
    expect(screen.getByText('Total Events')).toBeInTheDocument()
    expect(screen.getByText('12.5K')).toBeInTheDocument()
    expect(screen.getByText('Matched Events')).toBeInTheDocument()
    expect(screen.getAllByText('1.8K').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Action Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Stream Breakdown')).toBeInTheDocument()
    expect(screen.getByText('CrowdStrike Detections')).toBeInTheDocument()
    expect(screen.getByTestId('policy-impact-delta')).toHaveTextContent('+320 vs saved policy')
  })

  it('shows empty state when runtime data is insufficient', () => {
    render(
      <PolicyImpactPanel
        impact={{
          window: '24h',
          total_events: 0,
          matched_events: 0,
          actions: {},
          streams: [],
          delta: { matched_events_change: null },
          data_available: false,
        }}
      />,
    )
    expect(screen.getByTestId('policy-impact-empty')).toHaveTextContent('Not enough runtime data yet')
  })

  it('shows loading state', () => {
    render(<PolicyImpactPanel impact={null} loading />)
    expect(screen.getByText(/Analyzing last 24 hours/i)).toBeInTheDocument()
  })
})
