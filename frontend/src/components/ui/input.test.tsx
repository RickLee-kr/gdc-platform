import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './input'

describe('Input', () => {
  it('associates its label and forwards disabled state', () => {
    render(<Input label="Package URL" disabled />)

    expect(screen.getByRole('textbox', { name: 'Package URL' })).toBeDisabled()
  })

  it('marks invalid input and describes it with the error', () => {
    render(<Input id="package-url" label="Package URL" error="Enter a valid HTTPS URL." />)

    const input = screen.getByRole('textbox', { name: 'Package URL' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'package-url-error')
    expect(screen.getByText('Enter a valid HTTPS URL.')).toHaveAttribute('id', 'package-url-error')
  })
})
