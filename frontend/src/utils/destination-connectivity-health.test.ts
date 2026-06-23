import { describe, expect, it } from 'vitest'
import {
  isDestinationConnectivityVerified,
  resolveDestinationListUiHealth,
} from './destination-connectivity-health'

describe('destination-connectivity-health', () => {
  it('treats explicit connectivity success as verified', () => {
    expect(
      isDestinationConnectivityVerified({
        last_connectivity_test_success: true,
        last_connectivity_test_at: '2026-06-23T10:00:00Z',
      }),
    ).toBe(true)
  })

  it('treats failed connectivity as not verified', () => {
    expect(
      isDestinationConnectivityVerified({
        last_connectivity_test_success: false,
        last_connectivity_test_at: '2026-06-23T10:00:00Z',
      }),
    ).toBe(false)
  })

  it('shows healthy on list when probe passed and no delivery traffic yet', () => {
    expect(
      resolveDestinationListUiHealth(
        { enabled: true, last_connectivity_test_success: true, last_connectivity_test_at: '2026-06-23T10:00:00Z' },
        {
          destination_id: 1,
          destination_name: 'MDS',
          destination_type: 'SYSLOG_TCP',
          enabled: true,
          health_status: 'ERROR',
          inbound_eps_1m: 0,
          failed_eps_1m: 0,
          avg_latency_ms: null,
          route_count: 1,
          last_success_at: null,
          last_error_at: null,
          last_error_message: null,
        },
        'Critical',
      ),
    ).toBe('Healthy')
  })
})
