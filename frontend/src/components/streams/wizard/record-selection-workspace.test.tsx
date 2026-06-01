import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildInitialState } from './wizard-state'
import { RecordSelectionWorkspace } from './record-selection-workspace'
import { getOperationalSample } from './wizard-operational-samples'

const ROOT_ARRAY = [{ creationTime: 100, locale: 'en' }, { creationTime: 200, locale: 'fr' }]

function renderWorkspace(
  overrides: {
    eventArrayPath?: string
    eventRootPath?: string
    checkpointSourcePath?: string
    payload?: unknown
  } = {},
) {
  const state = buildInitialState()
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.parsedJson = overrides.payload ?? ROOT_ARRAY
  state.apiTest.rawResponse = overrides.payload ?? ROOT_ARRAY
  state.stream.eventArrayPath = overrides.eventArrayPath ?? '$'
  state.stream.eventRootPath = overrides.eventRootPath ?? ''
  state.stream.checkpointSourcePath = overrides.checkpointSourcePath ?? ''
  state.stream.useWholeResponseAsEvent = false

  const onSetEventArrayPath = vi.fn()
  const onSetEventRootPath = vi.fn()
  const onSetCheckpoint = vi.fn()

  render(
    <RecordSelectionWorkspace
      state={state}
      onSetEventArrayPath={onSetEventArrayPath}
      onSetEventRootPath={onSetEventRootPath}
      onSetCheckpoint={onSetCheckpoint}
    />,
  )

  return { onSetEventArrayPath, onSetEventRootPath, onSetCheckpoint }
}

describe('RecordSelectionWorkspace', () => {
  it('shows root array summary and preview sample', () => {
    renderWorkspace()
    expect(screen.getByText('Record Selection')).toBeTruthy()
    expect(screen.getByTestId('summary-event-source')).toHaveTextContent('$')
    expect(screen.getByTestId('summary-preview')).toHaveTextContent('$[0]')
    expect(screen.getByTestId('summary-runtime')).toHaveTextContent('$[*]')
    expect(screen.getByTestId('summary-records')).toHaveTextContent('2')
  })

  it('shows CloudTrail-style extraction summary', () => {
    const sample = getOperationalSample('aws_cloudtrail')
    renderWorkspace({
      payload: sample.payload,
      eventArrayPath: '$.Records',
      eventRootPath: '$.event',
    })
    expect(screen.getByTestId('summary-runtime')).toHaveTextContent('$.Records[*].event')
    expect(screen.getByTestId('summary-preview')).toHaveTextContent('$.Records[0]')
    expect(screen.getByTestId('summary-records')).toHaveTextContent('10')
  })

  it('updates summary when Event source chip is clicked', async () => {
    const user = userEvent.setup()
    const cloudtrail = getOperationalSample('aws_cloudtrail')
    const { onSetEventArrayPath } = renderWorkspace({ payload: cloudtrail.payload, eventArrayPath: '$' })

    await user.click(screen.getByRole('button', { name: /\$\.Records · 10 (records|events)/i }))

    expect(onSetEventArrayPath).toHaveBeenCalledWith('$.Records')
    expect(screen.getByTestId('summary-event-source')).toHaveTextContent('$.Records')
    expect(screen.getByTestId('summary-preview')).toHaveTextContent('$.Records[0]')
    expect(screen.getByTestId('summary-runtime')).toHaveTextContent('$.Records[*]')
    expect(screen.getByTestId('summary-records')).toHaveTextContent('10')
  })

  it('updates checkpoint summary when a field checkpoint is chosen', async () => {
    const user = userEvent.setup()
    const { onSetCheckpoint } = renderWorkspace()

    for (const btn of screen.getAllByRole('button', { name: /as Checkpoint$/i })) {
      await user.click(btn)
      const patch = onSetCheckpoint.mock.calls.at(-1)?.[0] as { checkpointSourcePath?: string }
      if (patch?.checkpointSourcePath?.startsWith('$.')) {
        expect(patch.checkpointSourcePath).toBe('$.creationTime')
        expect(screen.getByTestId('summary-runtime')).toHaveTextContent('$[*]')
        return
      }
    }
    throw new Error('Expected a leaf checkpoint selection to set $.creationTime')
  })
})
