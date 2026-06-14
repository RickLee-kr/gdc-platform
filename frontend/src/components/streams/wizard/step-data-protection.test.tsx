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
    expect(screen.getByText(/Detected Fields/i)).toBeInTheDocument()
    expect(screen.getByText(/Protection Action/i)).toBeInTheDocument()
    expect(screen.getByText(/Delivery Behavior/i)).toBeInTheDocument()
    expect(screen.queryByText(/Remove from delivery/i)).not.toBeInTheDocument()
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

  it('lists protection actions without Remove from delivery', () => {
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'row-1', detectedField: '$.email', protectionAction: 'mask_partial', deliveryBehavior: 'continue' },
    ]
    render(<StepDataProtection state={state} onChange={vi.fn()} />)

    const select = screen.getByDisplayValue('Mask (partial)')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['Audit only', 'Mask (partial)', 'Mask (full)', 'Tokenize', 'Hash'])
    expect(options).not.toContain('Remove from delivery')
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

  it('renders schema drift policy section with defaults', () => {
    const state = buildInitialState()
    render(<StepDataProtection state={state} onChange={vi.fn()} />)

    expect(screen.getByTestId('schema-drift-policy-section')).toBeInTheDocument()
    expect(screen.getByTestId('schema-drift-unknown-normal-field-policy-pass_through')).toBeChecked()
    expect(screen.getByTestId('schema-drift-unknown-sensitive-field-policy-auto_protect')).toBeChecked()
  })

  it('orders schema drift policy before protection rules', () => {
    const state = buildInitialState()
    render(<StepDataProtection state={state} onChange={vi.fn()} />)

    const drift = screen.getByTestId('schema-drift-policy-section')
    const rules = screen.getByTestId('protection-rules-section')
    expect(drift.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps schema drift settings outside protection rules section', () => {
    const state = buildInitialState()
    render(<StepDataProtection state={state} onChange={vi.fn()} />)

    const rules = screen.getByTestId('protection-rules-section')
    expect(rules).not.toContainElement(screen.getByTestId('schema-drift-unknown-normal-field-policy-group'))
    expect(rules).not.toContainElement(screen.getByTestId('schema-drift-unknown-sensitive-field-policy-group'))
  })

  it('persists schema drift policy changes via onChange', () => {
    const onChange = vi.fn()
    const state = buildInitialState()
    render(<StepDataProtection state={state} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('schema-drift-unknown-normal-field-policy-quarantine'))
    expect(onChange).toHaveBeenCalledWith({ unknownNormalFieldPolicy: 'quarantine' })

    fireEvent.click(screen.getByTestId('schema-drift-unknown-sensitive-field-policy-require_review'))
    expect(onChange).toHaveBeenCalledWith({ unknownSensitiveFieldPolicy: 'require_review' })
  })
})
