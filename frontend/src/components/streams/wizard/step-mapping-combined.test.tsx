import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepMappingCombined } from './step-mapping-combined'
import { buildInitialState } from './wizard-state'

vi.mock('../../mappings/mapping-workspace', () => ({
  MappingWorkspace: ({ headerSlot }: { headerSlot?: React.ReactNode }) => (
    <div data-testid="mock-mapping-workspace">{headerSlot}</div>
  ),
}))

vi.mock('./wizard-transform-rules-panel', () => ({
  WizardTransformRulesPanel: () => <div data-testid="mock-transform-rules-panel" />,
}))

vi.mock('./metadata-mapping-menu', () => ({
  MetadataMappingMenu: () => <button type="button">Metadata profile</button>,
}))

describe('StepMappingCombined v3 Transform shell', () => {
  it('uses Transform terminology and hides Mapping/Enrichment section labels', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.parsedJson = { events: [{ id: 'e1' }] }
    state.apiTest.extractedEvents = [{ id: 'e1' }]
    state.stream.eventArrayPath = '$.events'

    render(
      <StepMappingCombined
        state={state}
        onChangeMapping={() => {}}
        onChangeEnrichment={() => {}}
      />,
    )

    expect(screen.getByTestId('wizard-step-transform')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-sections')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-section-output_fields')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-section-transform_rules')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-section-output_verification')).toBeInTheDocument()
    expect(screen.queryByText(/Enrichment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Field Mapping/i)).not.toBeInTheDocument()
    expect(screen.getByText('Transform')).toBeInTheDocument()
  })
})
