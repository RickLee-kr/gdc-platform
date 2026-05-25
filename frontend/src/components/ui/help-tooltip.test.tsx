import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpTooltip } from './help-tooltip'

describe('HelpTooltip', () => {
  it('renders an accessible trigger and tooltip with content and example', () => {
    render(
      <HelpTooltip
        label="Checkpoint"
        content="Only fetches events after the last successful delivery."
        example="updated_after={{checkpoint.last_timestamp}}"
      />,
    )

    const trigger = screen.getByRole('button', { name: /Checkpoint help/i })
    expect(trigger).toBeInTheDocument()

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Only fetches events after the last successful delivery.')
    expect(tooltip).toHaveTextContent('updated_after={{checkpoint.last_timestamp}}')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
  })

  it('falls back to a generic aria-label when no label is provided', () => {
    render(<HelpTooltip content="Short helper" />)
    expect(screen.getByRole('button', { name: /More info/i })).toBeInTheDocument()
  })

  it('exposes title attribute as a non-styled hover fallback', () => {
    render(
      <HelpTooltip
        ariaLabel="Failure policy help"
        content="Controls what happens when delivery fails."
      />,
    )
    expect(screen.getByRole('button', { name: 'Failure policy help' })).toHaveAttribute(
      'title',
      expect.stringContaining('Controls what happens when delivery fails.'),
    )
  })
})
