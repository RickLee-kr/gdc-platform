import { describe, expect, it } from 'vitest'
import type { OperationalRouteSnapshot } from '../api/operationalSnapshot'
import { destinationLabelsByStreamIdFromSnapshot } from './streams-console-destination-labels'

function route(partial: Partial<OperationalRouteSnapshot> & Pick<OperationalRouteSnapshot, 'route_id' | 'stream_id'>): OperationalRouteSnapshot {
  return {
    stream_name: null,
    destination_id: null,
    destination_name: null,
    destination_type: null,
    enabled: true,
    failure_policy: null,
    health_status: 'HEALTHY',
    delivered_eps_1m: 0,
    failed_eps_1m: 0,
    success_rate_5m: 100,
    retry_rate_5m: 0,
    avg_latency_ms: null,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    ...partial,
  }
}

describe('destinationLabelsByStreamIdFromSnapshot', () => {
  it('maps single destination name per stream', () => {
    const map = destinationLabelsByStreamIdFromSnapshot([
      route({ route_id: 1, stream_id: 10, destination_id: 99, destination_name: 'Splunk Prod' }),
    ])
    expect(map.get(10)).toEqual(['Splunk Prod'])
  })

  it('dedupes multiple routes to the same destination and sorts multi-destination labels', () => {
    const map = destinationLabelsByStreamIdFromSnapshot([
      route({ route_id: 1, stream_id: 10, destination_id: 2, destination_name: 'Zebra' }),
      route({ route_id: 2, stream_id: 10, destination_id: 1, destination_name: 'Alpha' }),
      route({ route_id: 3, stream_id: 10, destination_id: 2, destination_name: 'Zebra' }),
    ])
    expect(map.get(10)).toEqual(['Alpha', 'Zebra'])
  })

  it('includes disabled routes (catalog parity)', () => {
    const map = destinationLabelsByStreamIdFromSnapshot([
      route({
        route_id: 1,
        stream_id: 10,
        destination_id: 5,
        destination_name: 'Archive',
        enabled: false,
      }),
    ])
    expect(map.get(10)).toEqual(['Archive'])
  })

  it('falls back when destination_name is missing', () => {
    const map = destinationLabelsByStreamIdFromSnapshot([
      route({ route_id: 1, stream_id: 10, destination_id: 42, destination_name: null }),
      route({ route_id: 2, stream_id: 11, destination_id: null, destination_name: '   ' }),
    ])
    expect(map.get(10)).toEqual(['Destination #42'])
    expect(map.has(11)).toBe(false)
  })

  it('returns empty map for streams with no routes / null input', () => {
    expect(destinationLabelsByStreamIdFromSnapshot(null).size).toBe(0)
    expect(destinationLabelsByStreamIdFromSnapshot([]).size).toBe(0)
  })
})
