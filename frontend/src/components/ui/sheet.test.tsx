import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetPortal,
  SheetTitle,
} from './sheet'

describe('Sheet', () => {
  it('renders a right-side dialog with title', async () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent data-testid="policy-editor-drawer">
            <SheetTitle>New policy</SheetTitle>
            <SheetDescription>Guided Policy Builder</SheetDescription>
            <SheetClose aria-label="Close">X</SheetClose>
          </SheetContent>
        </SheetPortal>
      </Sheet>,
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-testid', 'policy-editor-drawer')
    expect(screen.getByText('New policy')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetPortal>
          <SheetBackdrop />
          <SheetContent>
            <SheetTitle>Drawer</SheetTitle>
            <button type="button">Inside</button>
          </SheetContent>
        </SheetPortal>
      </Sheet>,
    )
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
