import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataProtectionReviewSummary } from './data-protection-review-summary'
import { buildInitialState } from './wizard-state'

describe('DataProtectionReviewSummary', () => {
  it('shows schema drift policy before protection rules', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'r1', detectedField: '$.token', protectionAction: 'tokenize', deliveryBehavior: 'block' },
    ]

    render(<DataProtectionReviewSummary dataProtection={state.dataProtection} />)

    const drift = screen.getByTestId('schema-drift-policy-summary')
    const rules = screen.getByTestId('protection-rules-summary')
    expect(drift.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rules).toHaveTextContent('$.token')
    expect(rules).toHaveTextContent('Tokenize')
    expect(rules).toHaveTextContent('Block delivery')
  })

  it('shows protection overrides summary when overrides exist', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'r1', detectedField: '$.email', protectionAction: 'mask_partial', deliveryBehavior: 'continue' },
    ]
    state.dataProtection.routeOverrides = [
      {
        key: 'o1',
        fieldPath: '$.email',
        routeDraftKey: 'rd-splunk',
        protectionAction: 'tokenize',
        deliveryBehavior: 'continue',
        enabled: true,
      },
    ]
    state.destinations.routeDrafts = [
      { key: 'rd-splunk', destinationId: 10, enabled: true, failurePolicy: 'LOG_AND_CONTINUE', rateLimitJson: {} },
    ]

    const labels = new Map([['rd-splunk', 'Splunk']])
    render(
      <DataProtectionReviewSummary
        dataProtection={state.dataProtection}
        routeDrafts={state.destinations.routeDrafts}
        destinationLabelsByDraftKey={labels}
      />,
    )

    expect(screen.getByTestId('route-protection-overrides-summary')).toBeInTheDocument()
    expect(screen.getByTestId('route-override-field-$.email')).toBeInTheDocument()
    expect(screen.getByText(/Splunk → Tokenize/)).toBeInTheDocument()
  })
})
