import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RequestPreviewDrawer } from './request-preview-drawer'

describe('RequestPreviewDrawer', () => {
  it('renders when open and calls onClose from backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <RequestPreviewDrawer
        open
        title="Request Preview"
        previewKindLabel="JSON Body"
        onClose={onClose}
        draft='{"from":"{{checkpoint.last_timestamp}}"}'
        onDraftChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('request-preview-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('request-preview-draft')).toHaveValue('{"from":"{{checkpoint.last_timestamp}}"}')
    await user.click(screen.getByTestId('request-preview-drawer-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('returns null when closed', () => {
    const { container } = render(
      <RequestPreviewDrawer
        open={false}
        title="Request Preview"
        previewKindLabel="JSON Body"
        onClose={vi.fn()}
        draft=""
        onDraftChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a draggable splitter when splitResults is enabled', () => {
    render(
      <RequestPreviewDrawer
        open
        title="Request Preview"
        previewKindLabel="JSON Body"
        onClose={vi.fn()}
        draft="{}"
        onDraftChange={vi.fn()}
        splitResults
      >
        <p data-testid="drawer-child">Test result content</p>
      </RequestPreviewDrawer>,
    )

    expect(screen.getByRole('separator', { name: /resize panels/i })).toBeInTheDocument()
    expect(screen.getByTestId('request-preview-drawer-results')).toBeInTheDocument()
    expect(screen.queryByTestId('request-preview-drawer-hints')).not.toBeInTheDocument()
  })

  it('uses full-height template without splitter before test results', () => {
    render(
      <RequestPreviewDrawer
        open
        title="Request Preview"
        previewKindLabel="JSON Body"
        onClose={vi.fn()}
        draft="{}"
        onDraftChange={vi.fn()}
        splitResults={false}
      >
        <p>Hint text</p>
      </RequestPreviewDrawer>,
    )

    expect(screen.queryByRole('separator', { name: /resize panels/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('request-preview-drawer-hints')).toBeInTheDocument()
  })
})
