import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from './dialog'

describe('Dialog', () => {
  it('exposes dialog role with title and description', async () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogContent data-testid="sample-dialog">
            <DialogTitle>Enable data governance?</DialogTitle>
            <DialogDescription>Adds a Data Policy step.</DialogDescription>
            <button type="button">Primary</button>
            <DialogClose>Close</DialogClose>
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-testid', 'sample-dialog')
    expect(screen.getByText('Enable data governance?')).toBeInTheDocument()
    expect(screen.getByText('Adds a Data Policy step.')).toBeInTheDocument()
  })

  it('calls onOpenChange(false) on Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogContent>
            <DialogTitle>Confirm</DialogTitle>
            <button type="button">Inside</button>
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps Tab focus inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogContent>
            <DialogTitle>Focus trap</DialogTitle>
            <button type="button">First</button>
            <button type="button">Second</button>
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    await screen.findByRole('dialog')
    const first = screen.getByRole('button', { name: 'First' })
    const second = screen.getByRole('button', { name: 'Second' })
    first.focus()
    expect(first).toHaveFocus()
    await user.tab()
    expect(second).toHaveFocus()
    await user.tab({ shift: true })
    expect(first).toHaveFocus()
  })
})
