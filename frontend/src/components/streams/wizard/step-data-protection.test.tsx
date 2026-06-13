import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepDataProtection } from './step-data-protection'
import { buildInitialState } from './wizard-state'

describe('StepDataProtection', () => {
  it('renders data protection step without engine terminology', () => {
    const state = buildInitialState()
    state.apiTest.analysis = {
      sampleEvent: { email: 'a@b.c' },
      flatPreviewFields: ['$.email'],
      detectedArrays: [],
      detectedCheckpointCandidates: [],
      previewError: null,
    }

    render(<StepDataProtection state={state} onChange={vi.fn()} />)

    expect(screen.getByTestId('wizard-step-data-protection')).toBeInTheDocument()
    expect(screen.getByText(/Detected field/i)).toBeInTheDocument()
    expect(screen.getByText(/Protection action/i)).toBeInTheDocument()
    expect(screen.getByText(/Delivery behavior/i)).toBeInTheDocument()
    expect(screen.queryByText(/Protection Engine/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Policy Engine/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Classification Engine/i)).not.toBeInTheDocument()
  })

  it('adds protection intent rows', () => {
    const onChange = vi.fn()
    const state = buildInitialState()
    render(<StepDataProtection state={state} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('data-protection-add-row'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        intents: expect.arrayContaining([
          expect.objectContaining({
            detectedField: '',
            protectionAction: 'mask_partial',
            deliveryBehavior: 'continue',
          }),
        ]),
      }),
    )
  })

  it('shows likely sensitive field suggestions', () => {
    const state = buildInitialState()
    state.apiTest.analysis = {
      sampleEvent: { user: { email: 'a@b.c' } },
      flatPreviewFields: ['$.user.email', '$.count'],
      detectedArrays: [],
      detectedCheckpointCandidates: [],
      previewError: null,
    }

    render(<StepDataProtection state={state} onChange={vi.fn()} />)
    expect(screen.getByTestId('data-protection-suggestions')).toBeInTheDocument()
    expect(screen.getByText('$.user.email')).toBeInTheDocument()
  })
})
