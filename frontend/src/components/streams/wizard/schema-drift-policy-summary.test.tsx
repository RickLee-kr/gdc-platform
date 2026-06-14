import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SchemaDriftPolicySummary } from './schema-drift-policy-summary'
import { buildInitialState } from './wizard-state'

describe('SchemaDriftPolicySummary', () => {
  it('displays schema drift policy review labels', () => {
    const state = buildInitialState()
    state.dataProtection.unknownNormalFieldPolicy = 'require_review'
    state.dataProtection.unknownSensitiveFieldPolicy = 'quarantine'

    render(<SchemaDriftPolicySummary dataProtection={state.dataProtection} />)

    const summary = screen.getByTestId('schema-drift-policy-summary')
    expect(summary).toHaveTextContent('Schema Drift Policy')
    expect(summary).toHaveTextContent('Unknown Normal Field')
    expect(summary).toHaveTextContent('Require Review')
    expect(summary).toHaveTextContent('Unknown Sensitive Field')
    expect(summary).toHaveTextContent('Quarantine')
  })

  it('does not show Phase 1 Auto Protect warning after Phase 2 runtime enforcement', () => {
    const state = buildInitialState()
    state.dataProtection.unknownSensitiveFieldPolicy = 'auto_protect'

    render(<SchemaDriftPolicySummary dataProtection={state.dataProtection} />)

    expect(screen.queryByTestId('schema-drift-auto-protect-phase1-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('schema-drift-policy-summary')).toHaveTextContent('Auto Protect')
  })
})
