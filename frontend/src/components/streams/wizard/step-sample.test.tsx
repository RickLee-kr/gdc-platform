import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StepSample } from './step-sample'
import { buildInitialState } from './wizard-state'

describe('StepSample UX simplification', () => {
  it('shows Run Test and Record Selection tabs only', () => {
    render(
      <MemoryRouter>
        <StepSample
          state={buildInitialState()}
          onApiTestChange={vi.fn()}
          onStreamPatch={vi.fn()}
          onSetEventArrayPath={vi.fn()}
          onSetEventRootPath={vi.fn()}
          onSetCheckpoint={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wizard-sample-tab-run_test')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-sample-tab-record_selection')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard-sample-tab-response')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-sample-tab-record_path')).not.toBeInTheDocument()
  })
})
