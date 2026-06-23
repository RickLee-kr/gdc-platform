import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IncrementalFetchBodyEditor } from './incremental-fetch-body-editor'
import { INCREMENTAL_FETCH_CHECKPOINT_HELPER } from './incremental-fetch-templates'

describe('IncrementalFetchBodyEditor', () => {
  it('shows checkpoint helper text and runtime variables', () => {
    render(<IncrementalFetchBodyEditor value="" onChange={vi.fn()} />)
    expect(screen.getByText(INCREMENTAL_FETCH_CHECKPOINT_HELPER)).toBeInTheDocument()
    expect(screen.queryByText('Incremental fetch templates')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Incremental Fetch Template' })).not.toBeInTheDocument()
    expect(screen.getByText('{{checkpoint.last_timestamp}}')).toBeInTheDocument()
    expect(screen.getByText('{{runtime.now_ms}}')).toBeInTheDocument()
  })

  it('hides onboarding copy when guidanceComplete is true', () => {
    render(<IncrementalFetchBodyEditor value="" onChange={vi.fn()} guidanceComplete />)
    expect(screen.queryByText(INCREMENTAL_FETCH_CHECKPOINT_HELPER)).not.toBeInTheDocument()
    expect(screen.queryByText('Checkpoint & runtime variables')).not.toBeInTheDocument()
  })

  it('renders incremental fetch compatibility hints for full fetch risk', () => {
    render(<IncrementalFetchBodyEditor value='{"limit":1000}' onChange={vi.fn()} />)
    expect(screen.getByTestId('incremental-fetch-compatibility-hints')).toBeInTheDocument()
    expect(screen.getByText(/No checkpoint variable found/)).toBeInTheDocument()
    expect(screen.getByText(/GDC only injects checkpoint variables where configured/)).toBeInTheDocument()
  })

  it('renders deprecated checkpoint compatibility hint', () => {
    render(<IncrementalFetchBodyEditor value='{"since":"{{checkpoint}}"}' onChange={vi.fn()} />)
    expect(screen.getByText(/Deprecated checkpoint variable found/)).toBeInTheDocument()
    expect(screen.getByText('DEPRECATED_CHECKPOINT_VARIABLE')).toBeInTheDocument()
  })

  it('renders timestamp sort compatibility hint when sort is missing', () => {
    render(
      <IncrementalFetchBodyEditor
        value={JSON.stringify({
          filters: [
            {
              fieldName: 'creationTime',
              operator: 'GreaterThan',
              values: ['{{checkpoint.last_timestamp}}'],
            },
          ],
        })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/ascending sort by the same field/)).toBeInTheDocument()
    expect(screen.getByText('SORT_REQUIRED')).toBeInTheDocument()
  })

  it('renders cursor incremental compatibility hint from query params', () => {
    render(
      <IncrementalFetchBodyEditor
        value=""
        onChange={vi.fn()}
        queryParams={{ cursor: '{{checkpoint.next_cursor}}' }}
      />,
    )
    expect(screen.getByText(/next cursor extraction/)).toBeInTheDocument()
    expect(screen.getByText('CURSOR_INCREMENTAL_LIKELY')).toBeInTheDocument()
  })
})
