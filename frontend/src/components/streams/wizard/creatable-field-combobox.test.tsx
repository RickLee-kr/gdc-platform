import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreatableFieldCombobox } from './creatable-field-combobox'

describe('CreatableFieldCombobox a11y', () => {
  it('associates the visible label and supports arrow keyboard selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <div>
        <span id="target-label">Target Field</span>
        <CreatableFieldCombobox
          value=""
          onChange={onChange}
          candidates={['email', 'username']}
          aria-labelledby="target-label"
          aria-required
          data-testid="target-field"
        />
      </div>,
    )

    const trigger = screen.getByTestId('target-field-trigger')
    expect(trigger).toHaveAttribute('aria-labelledby', 'target-label')
    expect(trigger).toHaveAttribute('aria-required', 'true')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')

    await user.click(trigger)
    const search = screen.getByTestId('target-field-search')
    expect(search).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('email')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <CreatableFieldCombobox value="email" onChange={() => {}} candidates={['email']} data-testid="cb" />,
    )
    await user.click(screen.getByTestId('cb-trigger'))
    expect(screen.getByTestId('cb-panel')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('cb-panel')).not.toBeInTheDocument()
  })
})
