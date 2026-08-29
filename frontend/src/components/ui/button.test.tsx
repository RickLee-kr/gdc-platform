import { render, screen } from '@testing-library/react'
import { Save } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('defaults to type button and supports disabled state', () => {
    render(<Button disabled>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('type', 'button')
  })

  it('gives an icon-only button an accessible name', () => {
    render(
      <Button size="icon" variant="ghost" aria-label="Save changes">
        <Save aria-hidden />
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })
})
