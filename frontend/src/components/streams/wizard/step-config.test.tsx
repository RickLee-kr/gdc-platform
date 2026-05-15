import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepConfig } from './step-config'
import { buildInitialState } from './wizard-state'

describe('StepConfig', () => {
  it('does not ask event array/checkpoint before API test', () => {
    const state = buildInitialState()
    render(<StepConfig state={state} onChange={vi.fn()} />)
    expect(screen.queryByText('Event array path')).not.toBeInTheDocument()
    expect(screen.queryByText('Checkpoint mode')).not.toBeInTheDocument()
    expect(screen.getByText('JSON Request Body (optional)')).toBeInTheDocument()
  })
})

