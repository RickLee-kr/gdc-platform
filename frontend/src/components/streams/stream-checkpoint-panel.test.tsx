import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamCheckpointPanel } from './stream-checkpoint-panel'
import * as gdcStreamConfiguration from '../../api/gdcStreamConfiguration'
import * as gdcRuntime from '../../api/gdcRuntime'

vi.mock('../../api/gdcStreamConfiguration', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcStreamConfiguration')>(
    '../../api/gdcStreamConfiguration',
  )
  return {
    ...actual,
    fetchStreamCheckpointManage: vi.fn(),
    resetStreamCheckpointManage: vi.fn(),
    updateStreamCheckpointManage: vi.fn(),
  }
})

vi.mock('../../api/gdcRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcRuntime')>('../../api/gdcRuntime')
  return {
    ...actual,
    fetchStreamCheckpointHistory: vi.fn(),
  }
})

vi.mock('../../lib/use-platform-environment', () => ({
  usePlatformEnvironment: () => ({
    appEnv: 'development',
    label: 'Development',
    loading: false,
    failed: false,
  }),
}))

describe('StreamCheckpointPanel reset guard', () => {
  beforeEach(() => {
    vi.mocked(gdcStreamConfiguration.fetchStreamCheckpointManage).mockResolvedValue({
      stream_id: 9,
      framework_enabled: false,
      checkpoint_type: 'cursor',
      checkpoint_value: { cursor: 'a' },
      legacy_checkpoint: { cursor: 'a' },
      fetch_checkpoint: null,
      delivery_checkpoint: null,
      updated_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_collected_event_at: null,
    } as never)
    vi.mocked(gdcRuntime.fetchStreamCheckpointHistory).mockResolvedValue({ items: [] } as never)
    vi.mocked(gdcStreamConfiguration.resetStreamCheckpointManage).mockResolvedValue({
      stream_id: 9,
      framework_enabled: false,
      checkpoint_type: 'cursor',
      checkpoint_value: {},
      legacy_checkpoint: {},
      fetch_checkpoint: null,
      delivery_checkpoint: null,
      updated_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_collected_event_at: null,
    } as never)
  })

  it('requires typed RESET confirmation before resetting', async () => {
    const user = userEvent.setup()
    render(<StreamCheckpointPanel streamId={9} />)
    await screen.findByTestId('checkpoint-reset-button')
    await user.click(screen.getByTestId('checkpoint-reset-button'))
    expect(screen.getByTestId('checkpoint-reset-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dangerous-action-confirm')).toBeDisabled()
    fireEvent.change(screen.getByTestId('dangerous-action-typed-confirm'), { target: { value: 'RESET' } })
    await user.click(screen.getByTestId('dangerous-action-confirm'))
    await waitFor(() => {
      expect(gdcStreamConfiguration.resetStreamCheckpointManage).toHaveBeenCalledWith(9, 'operator reset')
    })
  })

  it('shows previous and new checkpoint values before save', async () => {
    vi.mocked(gdcStreamConfiguration.updateStreamCheckpointManage).mockResolvedValue({
      stream_id: 9,
      framework_enabled: false,
      checkpoint_type: 'cursor',
      checkpoint_value: { cursor: 'b' },
      legacy_checkpoint: { cursor: 'b' },
      fetch_checkpoint: null,
      delivery_checkpoint: null,
      updated_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_collected_event_at: null,
    } as never)

    const user = userEvent.setup()
    render(<StreamCheckpointPanel streamId={9} />)
    const editor = await screen.findByTestId('checkpoint-legacy-json')
    fireEvent.change(editor, { target: { value: '{"cursor":"b"}' } })
    await user.click(screen.getByTestId('checkpoint-save-button'))
    expect(await screen.findByTestId('checkpoint-save-dialog')).toBeInTheDocument()
    expect(screen.getByText(/Previous:/i)).toBeInTheDocument()
    expect(screen.getByText(/New:/i)).toBeInTheDocument()
    expect(gdcStreamConfiguration.updateStreamCheckpointManage).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('dangerous-action-confirm'))
    await waitFor(() => {
      expect(gdcStreamConfiguration.updateStreamCheckpointManage).toHaveBeenCalledWith(9, {
        checkpoint_value: { cursor: 'b' },
      })
    })
  })
})
