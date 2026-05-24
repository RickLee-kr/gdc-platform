import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IncrementalFetchBodyEditor } from './incremental-fetch-body-editor'
import { INCREMENTAL_FETCH_CHECKPOINT_HELPER } from './incremental-fetch-templates'

describe('IncrementalFetchBodyEditor', () => {
  it('shows checkpoint helper text and template labels', () => {
    render(<IncrementalFetchBodyEditor value="" onChange={vi.fn()} />)
    expect(screen.getByText(INCREMENTAL_FETCH_CHECKPOINT_HELPER)).toBeInTheDocument()
    expect(screen.getByText('No checkpoint / full fetch')).toBeInTheDocument()
    expect(screen.getByText('Elasticsearch / Stellar _search')).toBeInTheDocument()
    expect(screen.getByText('{{checkpoint.last_timestamp}}')).toBeInTheDocument()
    expect(screen.getByText('{{runtime.now_ms}}')).toBeInTheDocument()
  })

  it('shows template warnings', () => {
    render(<IncrementalFetchBodyEditor value="" onChange={vi.fn()} />)
    expect(screen.getByTestId('template-warning-full_fetch')).toHaveTextContent('does not use checkpoint variables')
    expect(screen.getByTestId('template-warning-cursor')).toHaveTextContent('next_cursor extraction')
    expect(screen.getByTestId('template-warning-elasticsearch_search')).toHaveTextContent('timestamp + _id')
  })

  it('inserts selected template JSON into the body editor', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IncrementalFetchBodyEditor value="" onChange={onChange} />)

    const buttons = screen.getAllByRole('button', { name: 'Use Incremental Fetch Template' })
    await user.click(buttons[1]!)

    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining('"{{checkpoint.last_timestamp}}"'),
    )
    expect(screen.getByTestId('template-body-preview-timestamp_filter')).toBeInTheDocument()
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
