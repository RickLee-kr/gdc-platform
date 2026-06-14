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
})
