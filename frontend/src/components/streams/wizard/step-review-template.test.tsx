import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepReview } from './step-review'
import { buildInitialState } from './wizard-state'

vi.mock('../../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

vi.mock('../../../api/gdcRuntimePreview', () => ({
  runEnrichmentExecPreview: vi.fn(async () => ({ ok: true, rows: [] })),
}))

describe('StepReview template materialization summary', () => {
  it('shows planned streams when templates are selected', () => {
    const state = buildInitialState()
    state.connector.registryModuleId = 'crowdstrike'
    state.connector.selectedTemplateIds = ['detections', 'incidents']
    state.connector.connectorId = 1
    state.connector.sourceId = 1

    render(
      <MemoryRouter>
        <StepReview
          state={state}
          onNavigateToStep={vi.fn()}
          governanceEnabled={false}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('review-template-materialization')).toBeInTheDocument()
    expect(screen.getByTestId('review-template-row-detections')).toBeInTheDocument()
    expect(screen.getByTestId('review-template-row-incidents')).toBeInTheDocument()
    expect(screen.getByText('crowdstrike')).toBeInTheDocument()
  })
})
