import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamCheckpointPanel } from './stream-checkpoint-panel'
import { StreamReplayPanel } from './stream-replay-panel'
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
    runStreamOperationalReplay: vi.fn(),
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

describe('workspace write UI RBAC gating', () => {
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
    })
    vi.mocked(gdcRuntime.fetchStreamCheckpointHistory).mockResolvedValue({ items: [] })
  })

  it('hides checkpoint save/reset when canOperate is false', async () => {
    render(<StreamCheckpointPanel streamId={9} canOperate={false} />)
    await waitFor(() => expect(screen.getByTestId('checkpoint-read-only-banner')).toBeInTheDocument())
    expect(screen.queryByTestId('checkpoint-save-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('checkpoint-reset-button')).not.toBeInTheDocument()
  })

  it('shows checkpoint save when canOperate is true', async () => {
    render(<StreamCheckpointPanel streamId={9} canOperate />)
    await waitFor(() => expect(screen.getByTestId('checkpoint-save-button')).toBeInTheDocument())
    expect(screen.getByTestId('checkpoint-reset-button')).toBeInTheDocument()
  })

  it('hides operational replay run when canOperate is false', () => {
    render(<StreamReplayPanel streamId={3} canOperate={false} />)
    expect(screen.getByTestId('replay-read-only-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('replay-run-button')).not.toBeInTheDocument()
  })

  it('shows operational replay run when canOperate is true', () => {
    render(<StreamReplayPanel streamId={3} canOperate />)
    expect(screen.getByTestId('replay-run-button')).toBeInTheDocument()
  })
})
