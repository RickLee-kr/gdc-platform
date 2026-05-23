import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationalStreamSnapshot } from '../../api/operationalSnapshot'
import { stabilizeOperationalSnapshot } from '../../lib/snapshot-stabilize'
import { RuntimeStreamCard, runtimeStreamCardPropsEqual } from './runtime-stream-card'

const stream: OperationalStreamSnapshot = {
  stream_id: 7,
  stream_name: 'Test Stream',
  connector_id: 1,
  source_id: 1,
  enabled: true,
  status: 'RUNNING',
  health_status: 'HEALTHY',
  eps_1m: 2,
  eps_5m: 2,
  success_rate_5m: 99,
  failure_rate_5m: 1,
  avg_latency_ms: 10,
  route_count: 1,
  healthy_route_count: 1,
  failed_route_count: 0,
  last_success_at: null,
  last_error_at: null,
  last_error_message: null,
  checkpoint_updated_at: null,
  checkpoint_lag_seconds: null,
}

describe('RuntimeStreamCard', () => {
  it('renders stream card and calls onSelect', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(<RuntimeStreamCard stream={stream} selected={false} onSelect={onSelect} />)
    screen.getByTestId('runtime-stream-card-7').click()
    expect(onSelect).toHaveBeenCalledWith(7)

    rerender(<RuntimeStreamCard stream={stream} selected onSelect={onSelect} />)
    expect(screen.getByTestId('runtime-stream-card-7')).toHaveClass('border-violet-400')
  })

  it('skips memo update when stream reference is unchanged after snapshot stabilize', () => {
    const onSelect = vi.fn()
    const first = stabilizeOperationalSnapshot(null, {
      global: {
        health_status: 'HEALTHY',
        total_streams: 1,
        enabled_streams: 1,
        running_streams: 1,
        error_streams: 0,
        total_routes: 0,
        enabled_routes: 0,
        total_destinations: 0,
        enabled_destinations: 0,
        total_eps_1m: 1,
        total_eps_5m: 1,
        avg_latency_ms: 1,
        last_activity_at: '2026-05-22T12:00:00Z',
      },
      streams: [stream],
      routes: [],
      destinations: [],
      problems: [],
      updated_at: '2026-05-22T12:00:00Z',
    })
    const second = stabilizeOperationalSnapshot(first, {
      ...first!,
      updated_at: '2026-05-22T12:00:01Z',
    })
    const stableStream = second!.streams[0]!
    expect(
      runtimeStreamCardPropsEqual(
        { stream: stableStream, selected: false, onSelect },
        { stream: stableStream, selected: false, onSelect },
      ),
    ).toBe(true)
  })

  it('requires new stream reference when operational metrics change', () => {
    const onSelect = vi.fn()
    const first = stabilizeOperationalSnapshot(null, {
      global: {
        health_status: 'HEALTHY',
        total_streams: 1,
        enabled_streams: 1,
        running_streams: 1,
        error_streams: 0,
        total_routes: 0,
        enabled_routes: 0,
        total_destinations: 0,
        enabled_destinations: 0,
        total_eps_1m: 1,
        total_eps_5m: 1,
        avg_latency_ms: 1,
        last_activity_at: '2026-05-22T12:00:00Z',
      },
      streams: [stream],
      routes: [],
      destinations: [],
      problems: [],
      updated_at: '2026-05-22T12:00:00Z',
    })
    const changed = { ...stream, eps_1m: 99 }
    const second = stabilizeOperationalSnapshot(first, {
      ...first!,
      streams: [changed],
      updated_at: '2026-05-22T12:00:01Z',
    })
    expect(second!.streams[0]).not.toBe(first!.streams[0])
    expect(
      runtimeStreamCardPropsEqual(
        { stream: first!.streams[0]!, selected: false, onSelect },
        { stream: second!.streams[0]!, selected: false, onSelect },
      ),
    ).toBe(false)
  })
})
