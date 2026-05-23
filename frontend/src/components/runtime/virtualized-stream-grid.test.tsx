import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationalStreamSnapshot } from '../../api/operationalSnapshot'
import { VirtualizedStreamGrid } from './virtualized-stream-grid'

function makeStreams(n: number): OperationalStreamSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    stream_id: i + 1,
    stream_name: `Stream ${i + 1}`,
    connector_id: 1,
    source_id: 1,
    enabled: true,
    status: 'RUNNING',
    health_status: 'HEALTHY' as const,
    eps_1m: 0,
    eps_5m: 0,
    success_rate_5m: 100,
    failure_rate_5m: 0,
    avg_latency_ms: null,
    route_count: 0,
    healthy_route_count: 0,
    failed_route_count: 0,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    checkpoint_updated_at: null,
    checkpoint_lag_seconds: null,
  }))
}

describe('VirtualizedStreamGrid', () => {
  it('mounts only a window of stream cards for large lists', () => {
    render(
      <VirtualizedStreamGrid
        streams={makeStreams(120)}
        routes={[]}
        focusStreamId={null}
        onFocusStream={vi.fn()}
        groupMode="none"
        collapsedGroups={new Set()}
        onToggleGroup={vi.fn()}
      />,
    )
    const cards = screen.queryAllByTestId(/runtime-stream-card-/)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThan(120)
    expect(screen.getByTestId('runtime-stream-virtual-scroll')).toBeInTheDocument()
  })
})
