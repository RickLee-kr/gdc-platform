import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { useDialogA11y } from './use-dialog-a11y'

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogA11y({
    open,
    onClose: () => {
      setOpen(false)
      onClose()
    },
    panelRef,
  })
  if (!open) return <button type="button">Trigger</button>
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Test dialog">
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  )
}

describe('useDialogA11y', () => {
  it('closes on Escape and restores focus flow', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab within the panel', async () => {
    const user = userEvent.setup()
    render(<Harness onClose={() => {}} />)
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    first.focus()
    await user.tab()
    expect(last).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
  })
})
