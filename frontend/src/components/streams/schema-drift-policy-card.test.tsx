import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SchemaDriftPolicyCard } from './schema-drift-policy-card'

describe('SchemaDriftPolicyCard', () => {
  it('renders read-only deployed policy labels', () => {
    render(
      <SchemaDriftPolicyCard
        policy={{
          unknownNormalField: 'Pass Through',
          unknownSensitiveField: 'Auto Protect',
        }}
      />,
    )

    const card = screen.getByTestId('schema-drift-policy-runtime-card')
    expect(card).toHaveTextContent('Schema Drift Policy')
    expect(card).toHaveTextContent('Unknown Normal Field')
    expect(card).toHaveTextContent('Pass Through')
    expect(card).toHaveTextContent('Unknown Sensitive Field')
    expect(card).toHaveTextContent('Auto Protect')
  })
})
