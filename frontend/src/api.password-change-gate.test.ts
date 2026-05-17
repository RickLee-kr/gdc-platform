import { afterEach, describe, expect, it, vi } from 'vitest'
import { PasswordChangeRequiredError, requestJson } from './api'
import { readSession, SESSION_STORAGE_KEY, clearSession, persistSession } from './auth/session'

describe('requestJson password-change gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  it('marks session and throws PasswordChangeRequiredError on 403 PASSWORD_CHANGE_REQUIRED', async () => {
    persistSession({
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      user: { username: 'admin', role: 'ADMINISTRATOR', status: 'ACTIVE' },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail: {
              error_code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'You must change your password before using this resource.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(requestJson('/api/v1/runtime/status')).rejects.toBeInstanceOf(PasswordChangeRequiredError)
    expect(readSession()?.user.must_change_password).toBe(true)
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('tok')
  })
})
