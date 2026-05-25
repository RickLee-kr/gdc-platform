import { describe, expect, it } from 'vitest'
import type { OperationalStreamSnapshot } from '../api/operationalSnapshot'
import {
  buildStreamVirtualItems,
  filterOperationalStreams,
} from './runtime-stream-selectors'

function stream(id: number, name: string, health: OperationalStreamSnapshot['health_status']): OperationalStreamSnapshot {
  return {
    stream_id: id,
    stream_name: name,
    connector_id: 1,
    source_id: 1,
    enabled: true,
    status: 'RUNNING',
    health_status: health,
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
  }
}

describe('filterOperationalStreams', () => {
  const streams = [stream(1, 'Alpha', 'HEALTHY'), stream(2, 'Beta Error', 'ERROR')]

  it('filters by tab and search', () => {
    expect(filterOperationalStreams(streams, 'error', '')).toHaveLength(1)
    expect(filterOperationalStreams(streams, 'all', 'alpha')).toHaveLength(1)
  })
})

describe('buildStreamVirtualItems', () => {
  it('omits streams in collapsed health groups', () => {
    const streams = [stream(1, 'A', 'HEALTHY'), stream(2, 'B', 'ERROR')]
    const items = buildStreamVirtualItems(streams, 'health', [], new Set(['ERROR']))
    const streamItems = items.filter((i) => i.kind === 'stream')
    expect(streamItems).toHaveLength(1)
    expect(streamItems[0]?.kind === 'stream' && streamItems[0].stream.stream_id).toBe(1)
  })
})
