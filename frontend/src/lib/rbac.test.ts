import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSessionCapabilities } from './rbac'

vi.mock('../auth/session', () => ({
  readSession: vi.fn(),
  onSessionChange: vi.fn(() => () => {}),
}))

import { readSession } from '../auth/session'

describe('getSessionCapabilities', () => {
  afterEach(() => {
    vi.mocked(readSession).mockReset()
  })

  it('treats missing session as full administrator affordances (dev shell)', () => {
    vi.mocked(readSession).mockReturnValue(null)
    const c = getSessionCapabilities()
    expect(c.workspace_mutations).toBe(true)
    expect(c.backup_import_apply).toBe(true)
  })

  it('marks viewer as read-only for mutations', () => {
    vi.mocked(readSession).mockReturnValue({
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      user: { username: 'v', role: 'VIEWER', status: 'ACTIVE' },
    })
    const c = getSessionCapabilities()
    expect(c.runtime_stream_control).toBe(false)
    expect(c.backfill_mutations).toBe(false)
    expect(c.read_only_monitoring).toBe(true)
  })

  it('merges server-provided capability flags', () => {
    vi.mocked(readSession).mockReturnValue({
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      user: {
        username: 'op',
        role: 'OPERATOR',
        status: 'ACTIVE',
        capabilities: { backup_import_apply: true },
      },
    })
    const c = getSessionCapabilities()
    expect(c.backup_import_apply).toBe(true)
  })
})
