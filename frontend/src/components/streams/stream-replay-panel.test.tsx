import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamReplayPanel } from './stream-replay-panel'
import * as gdcStreamConfiguration from '../../api/gdcStreamConfiguration'

vi.mock('../../api/gdcStreamConfiguration', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcStreamConfiguration')>(
    '../../api/gdcStreamConfiguration',
  )
  return {
    ...actual,
    runStreamOperationalReplay: vi.fn(),
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

describe('StreamReplayPanel apply dedup toggle', () => {
  beforeEach(() => {
    vi.mocked(gdcStreamConfiguration.runStreamOperationalReplay).mockReset()
    vi.mocked(gdcStreamConfiguration.runStreamOperationalReplay).mockResolvedValue({
      stream_id: 7,
      mode: 'last_n_minutes',
      dry_run: true,
      apply_dedup: true,
      outcome: 'completed',
      message: 'ok',
      event_count: 1,
      checkpoint_unchanged: true,
    })
  })

  it('defaults Apply deduplication to on and sends apply_dedup=true', async () => {
    const user = userEvent.setup()
    render(<StreamReplayPanel streamId={7} />)

    const toggle = screen.getByTestId('replay-apply-dedup') as HTMLInputElement
    expect(toggle.checked).toBe(true)

    await user.selectOptions(screen.getByTestId('replay-mode-select'), 'last_n_minutes')
    await user.click(screen.getByTestId('replay-run-button'))

    await waitFor(() => {
      expect(gdcStreamConfiguration.runStreamOperationalReplay).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          mode: 'last_n_minutes',
          dry_run: true,
          apply_dedup: true,
        }),
      )
    })
  })

  it('requires confirmation before live replay executes', async () => {
    const user = userEvent.setup()
    render(<StreamReplayPanel streamId={7} />)

    await user.selectOptions(screen.getByTestId('replay-mode-select'), 'last_n_minutes')
    await user.click(screen.getByTestId('replay-dry-run'))
    await user.click(screen.getByTestId('replay-run-button'))

    expect(gdcStreamConfiguration.runStreamOperationalReplay).not.toHaveBeenCalled()
    expect(screen.getByTestId('replay-live-confirm-dialog')).toBeInTheDocument()
    await user.click(screen.getByTestId('dangerous-action-confirm'))

    await waitFor(() => {
      expect(gdcStreamConfiguration.runStreamOperationalReplay).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ dry_run: false }),
      )
    })
  })

  it('sends apply_dedup=false when the toggle is turned off for dry-run and live replay', async () => {
    const user = userEvent.setup()
    render(<StreamReplayPanel streamId={7} />)

    await user.selectOptions(screen.getByTestId('replay-mode-select'), 'last_n_minutes')
    await user.click(screen.getByTestId('replay-apply-dedup'))
    expect((screen.getByTestId('replay-apply-dedup') as HTMLInputElement).checked).toBe(false)

    await user.click(screen.getByTestId('replay-run-button'))
    await waitFor(() => {
      expect(gdcStreamConfiguration.runStreamOperationalReplay).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ dry_run: true, apply_dedup: false }),
      )
    })

    await user.click(screen.getByTestId('replay-dry-run'))
    await user.click(screen.getByTestId('replay-run-button'))
    expect(screen.getByTestId('replay-live-confirm-dialog')).toBeInTheDocument()
    await user.click(screen.getByTestId('dangerous-action-confirm'))
    await waitFor(() => {
      expect(gdcStreamConfiguration.runStreamOperationalReplay).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ dry_run: false, apply_dedup: false }),
      )
    })
  })
})
