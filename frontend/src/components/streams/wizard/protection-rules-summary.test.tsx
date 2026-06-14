import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProtectionRulesSummary } from './protection-rules-summary'
import { buildInitialState } from './wizard-state'

describe('ProtectionRulesSummary', () => {
  it('shows empty state when no rules configured', () => {
    render(<ProtectionRulesSummary dataProtection={buildInitialState().dataProtection} />)
    expect(screen.getByTestId('protection-rules-summary')).toHaveTextContent('No protection rules configured')
  })

  it('lists configured protection rules', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'r1', detectedField: '$.ssn', protectionAction: 'mask_full', deliveryBehavior: 'quarantine' },
    ]
    render(<ProtectionRulesSummary dataProtection={state.dataProtection} />)

    const summary = screen.getByTestId('protection-rules-summary')
    expect(summary).toHaveTextContent('Detected Fields')
    expect(summary).toHaveTextContent('$.ssn')
    expect(summary).toHaveTextContent('Mask (full)')
    expect(summary).toHaveTextContent('Quarantine')
  })
})
