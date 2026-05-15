import { describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import { fetchRouteFailuresAnalytics } from './gdcRuntimeAnalytics'

describe('gdcRuntimeAnalytics', () => {
  it('requests route failures with query string params', async () => {
    const spy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      time: { window: '24h', since: '', until: '' },
      filters: { stream_id: null, route_id: null, destination_id: null },
      totals: { failure_events: 0, success_events: 0, overall_failure_rate: 0 },
      latency_ms_avg: null,
      latency_ms_p95: null,
      last_failure_at: null,
      last_success_at: null,
      outcomes_by_route: [],
      failures_by_destination: [],
      failures_by_stream: [],
      failure_trend: [],
      top_error_codes: [],
      top_failed_stages: [],
      unstable_routes: [],
    })
    await fetchRouteFailuresAnalytics({ window: '24h', stream_id: 9, route_id: 2 })
    expect(spy).toHaveBeenCalled()
    const url = String(spy.mock.calls[0]?.[0] ?? '')
    expect(url).toContain('/runtime/analytics/routes/failures')
    expect(url).toContain('window=24h')
    expect(url).toContain('stream_id=9')
    expect(url).toContain('route_id=2')
    spy.mockRestore()
  })
})
