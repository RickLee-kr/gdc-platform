import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistSession, clearSession } from '../auth/session'
import { fetchRuntimeDashboardSummary, fetchStreamRuntimeStatsHealth } from './gdcRuntime'
import { fetchStreamsListResult } from './gdcStreams'

describe('runtime/streams polling Authorization header', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('sends Bearer token on streams list, dashboard summary, and stats-health polling', async () => {
    persistSession({
      access_token: 'poll-access-token',
      refresh_token: 'poll-refresh-token',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      user: { username: 'operator', role: 'OPERATOR', status: 'ACTIVE' },
    })

    const headers: Record<string, string>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const h = init?.headers
        if (h instanceof Headers) {
          headers.push(Object.fromEntries(h.entries()))
        } else if (h && typeof h === 'object') {
          headers.push(h as Record<string, string>)
        } else {
          headers.push({})
        }
        const url = String(_input)
        if (url.includes('/streams/') && !url.includes('/stats-health')) {
          return new Response(JSON.stringify([{ id: 1, name: 's1', connector_id: 1, source_id: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/dashboard/summary')) {
          return new Response(JSON.stringify({ summary: { total_streams: 1 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.includes('/stats-health')) {
          return new Response(
            JSON.stringify({
              stats: { stream_id: 1, stream_status: 'RUNNING', summary: {}, last_seen: {}, routes: [], recent_logs: [] },
              health: { stream_id: 1, stream_status: 'RUNNING', health: 'IDLE', limit: 80, summary: {}, routes: [] },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    await fetchStreamsListResult()
    await fetchRuntimeDashboardSummary(100, '1h')
    await fetchStreamRuntimeStatsHealth(1, 80)

    expect(headers.length).toBeGreaterThanOrEqual(3)
    for (const h of headers) {
      expect(h.Authorization).toBe('Bearer poll-access-token')
    }
  })
})
