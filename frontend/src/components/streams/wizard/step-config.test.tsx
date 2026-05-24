import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { INCREMENTAL_FETCH_CHECKPOINT_HELPER } from '../incremental-fetch-templates'
import { StepConfig } from './step-config'
import { buildInitialState } from './wizard-state'

describe('StepConfig', () => {
  it('does not ask event array/checkpoint before API test', () => {
    const state = buildInitialState()
    render(<StepConfig state={state} onChange={vi.fn()} />)
    expect(screen.queryByText('Event array path')).not.toBeInTheDocument()
    expect(screen.queryByText('Checkpoint mode')).not.toBeInTheDocument()
    expect(screen.getByText('JSON Request Body (optional)')).toBeInTheDocument()
    expect(screen.getByText(INCREMENTAL_FETCH_CHECKPOINT_HELPER)).toBeInTheDocument()
    expect(screen.queryByText('Use Example Body')).not.toBeInTheDocument()
  })

  it('inserts incremental fetch template into request body via onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const state = buildInitialState()
    render(<StepConfig state={state} onChange={onChange} />)

    const buttons = screen.getAllByRole('button', { name: 'Use Incremental Fetch Template' })
    await user.click(buttons[4]!)

    expect(onChange).toHaveBeenCalledWith({
      requestBody: expect.stringContaining('"{{checkpoint.last_event_id}}"'),
    })
  })
})
