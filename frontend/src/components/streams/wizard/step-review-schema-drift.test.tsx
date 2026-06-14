import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepReview } from './step-review'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

vi.mock('../../../api/gdcRuntimePreview', () => ({
  runEnrichmentExecPreview: vi.fn(async ({ mapped_event }: { mapped_event: Record<string, unknown> }) => ({
    final_event: mapped_event,
  })),
}))

describe('StepReview data protection summary', () => {
  it('displays schema drift policy before protection rules', async () => {
    const state = buildInitialState()
    state.dataProtection.unknownNormalFieldPolicy = 'pass_through'
    state.dataProtection.unknownSensitiveFieldPolicy = 'auto_protect'
    state.dataProtection.intents = [
      { key: 'r1', detectedField: '$.email', protectionAction: 'hash', deliveryBehavior: 'quarantine' },
    ]

    render(
      <MemoryRouter>
        <StepReview state={state} onNavigateToStep={vi.fn()} governanceEnabled={false} />
      </MemoryRouter>,
    )

    const section = await screen.findByTestId('review-data-protection')
    const summary = screen.getByTestId('data-protection-review-summary')
    const drift = screen.getByTestId('schema-drift-policy-summary')
    const rules = screen.getByTestId('protection-rules-summary')

    expect(section).toBeInTheDocument()
    expect(summary).toHaveTextContent('Schema Drift Policy')
    expect(summary).toHaveTextContent('Pass Through')
    expect(summary).toHaveTextContent('Auto Protect')
    expect(summary).toHaveTextContent('Protection Rules')
    expect(summary).toHaveTextContent('$.email')
    expect(summary).toHaveTextContent('Hash')
    expect(drift.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
