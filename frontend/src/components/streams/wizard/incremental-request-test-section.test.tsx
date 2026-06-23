import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildInitialState } from './wizard-state'
import {
  IncrementalRequestTestButton,
  useIncrementalRequestTest,
} from './incremental-request-test-section'
import { renderHook } from '@testing-library/react'

describe('IncrementalRequestTestButton', () => {
  it('renders inactive styling and blocks click when disabled with reason', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <IncrementalRequestTestButton
        testing={false}
        disabled
        disabledReason="Select a checkpoint field with values first."
        onClick={onClick}
      />,
    )

    const button = screen.getByTestId('incremental-request-test-button')
    expect(button).toBeDisabled()
    expect(button.className).toContain('bg-slate-200')
    expect(button.className).not.toContain('bg-violet-600')
    expect(screen.getByText('Select a checkpoint field with values first.')).toBeInTheDocument()

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('useIncrementalRequestTest', () => {
  it('disables test when checkpoint Example is a non-scalar object', () => {
    const state = buildInitialState()
    state.stream.incrementalRequestPattern = 'visualsearch_query'
    state.stream.incrementalRequestDraft = '{"queryPath":[]}'
    state.stream.checkpointSourcePath = '$.executionStep'

    const { result } = renderHook(() =>
      useIncrementalRequestTest({
        state,
        eventSourceRecords: [{ creationTime: '2024-06-21T02:00:00.000Z' }],
        previewRecord: { executionStep: { id: '6655847b' } },
        eventArrayPath: '$',
        eventRootPath: '',
        checkpointSourcePath: '$.executionStep',
        checkpointFieldType: 'STRING',
        pattern: 'visualsearch_query',
        draft: state.stream.incrementalRequestDraft,
        resolvedSampleValue: { id: '6655847b' },
      }),
    )

    expect(result.current.testDisabled).toBe(true)
    expect(result.current.testDisabledReason).toBe('Select a checkpoint field with values first.')
  })
})
