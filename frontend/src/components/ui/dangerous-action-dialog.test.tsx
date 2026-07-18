import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DangerousActionDialog } from './dangerous-action-dialog'

describe('DangerousActionDialog', () => {
  it('requires typed confirmation before enabling confirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DangerousActionDialog
        open
        title="Reset checkpoint?"
        typedConfirmPhrase="RESET"
        impactItems={['Checkpoint position will be cleared.']}
        environmentLabel="Development"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByTestId('dangerous-action-environment')).toHaveTextContent('Development')
    const confirm = screen.getByTestId('dangerous-action-confirm')
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByTestId('dangerous-action-typed-confirm'), { target: { value: 'RESET' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('allows high-risk confirm without typed phrase', () => {
    const onConfirm = vi.fn()
    render(
      <DangerousActionDialog open title="Run Now?" confirmTone="warning" onCancel={() => {}} onConfirm={onConfirm} />,
    )
    fireEvent.click(screen.getByTestId('dangerous-action-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape and confirms on Enter when enabled', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DangerousActionDialog
        open
        title="Start stream?"
        confirmTone="warning"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)

    onCancel.mockClear()
    render(
      <DangerousActionDialog
        open
        title="Start stream again?"
        confirmTone="warning"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalled()
  })

  it('does not confirm on Enter when typed phrase is incomplete', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <DangerousActionDialog
        open
        title="Delete?"
        typedConfirmPhrase="DELETE"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('guards against double confirm clicks', async () => {
    const onConfirm = vi.fn()
    render(
      <DangerousActionDialog open title="Start stream?" confirmTone="warning" onCancel={() => {}} onConfirm={onConfirm} />,
    )
    const confirm = screen.getByTestId('dangerous-action-confirm')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
