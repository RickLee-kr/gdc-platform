import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamDedupPanel } from './stream-dedup-panel'
import * as gdcStreamConfiguration from '../../api/gdcStreamConfiguration'

vi.mock('../../api/gdcStreamConfiguration', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcStreamConfiguration')>(
    '../../api/gdcStreamConfiguration',
  )
  return {
    ...actual,
    fetchStreamDeduplication: vi.fn(),
    saveStreamDeduplication: vi.fn(),
  }
})

describe('StreamDedupPanel runtime stats', () => {
  beforeEach(() => {
    vi.mocked(gdcStreamConfiguration.fetchStreamDeduplication).mockReset()
    vi.mocked(gdcStreamConfiguration.saveStreamDeduplication).mockReset()
  })

  it('renders recent runtime counters when summary is present', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamDeduplication).mockResolvedValue({
      enabled: true,
      key_field: 'event_id',
      custom_jsonpath: null,
      duplicate_handling: 'skip_duplicate',
      scope: 'checkpoint_window',
      window_hours: null,
      last_runtime_duplicate_count: 2,
      last_runtime_stats_degraded: false,
      last_runtime_dedup_summary: {
        total_events: 10,
        inserted: 8,
        duplicate_events: 2,
        duplicate_handling: 'skip_duplicate',
        dedup_scope: 'checkpoint_window',
        recorded_at: '2026-07-14T01:00:00Z',
      },
    })

    render(<StreamDedupPanel streamId={42} />)

    await waitFor(() => {
      expect(screen.getByTestId('dedup-runtime-stats-grid')).toBeInTheDocument()
    })
    const stats = screen.getByTestId('dedup-runtime-stats-grid')
    expect(stats).toHaveTextContent('Input events')
    expect(stats).toHaveTextContent('10')
    expect(stats).toHaveTextContent('Duplicates skipped')
    expect(stats).toHaveTextContent('2')
    expect(stats).toHaveTextContent('Forwarded')
    expect(stats).toHaveTextContent('8')
    expect(stats).toHaveTextContent('Applied scope')
    expect(stats).toHaveTextContent('Checkpoint window')
    expect(stats).toHaveTextContent('Duplicate handling')
    expect(stats).toHaveTextContent('Skip duplicate')
  })

  it('shows empty state when no recent stats exist', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamDeduplication).mockResolvedValue({
      enabled: false,
      key_field: 'event_id',
      custom_jsonpath: null,
      duplicate_handling: 'skip_duplicate',
      scope: 'current_run',
      window_hours: null,
      last_runtime_duplicate_count: 0,
      last_runtime_dedup_summary: null,
      last_runtime_stats_degraded: false,
    })

    render(<StreamDedupPanel streamId={7} />)

    await waitFor(() => {
      expect(screen.getByTestId('dedup-runtime-empty')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dedup-runtime-stats-grid')).not.toBeInTheDocument()
    expect(screen.getByTestId('dedup-enabled')).toBeInTheDocument()
  })

  it('keeps the settings form usable when stats lookup is degraded', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamDeduplication).mockResolvedValue({
      enabled: true,
      key_field: 'event_id',
      custom_jsonpath: null,
      duplicate_handling: 'keep_latest',
      scope: 'current_run',
      window_hours: null,
      last_runtime_duplicate_count: 0,
      last_runtime_dedup_summary: null,
      last_runtime_stats_degraded: true,
    })

    render(<StreamDedupPanel streamId={9} />)

    await waitFor(() => {
      expect(screen.getByTestId('dedup-runtime-degraded')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dedup-enabled')).toBeChecked()
    expect(screen.getByTestId('dedup-save-button')).toBeEnabled()
  })
})
