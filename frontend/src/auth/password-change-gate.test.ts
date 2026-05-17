import { afterEach, describe, expect, it } from 'vitest'
import {
  errorIndicatesPasswordChangeRequired,
  extractHttpErrorCode,
  markSessionRequiresPasswordChange,
  PasswordChangeRequiredError,
  syncSessionFromWhoAmI,
} from './password-change-gate'
import { clearSession, persistSession, readSession, SESSION_STORAGE_KEY } from './session'

function seedSession(mustChange = false) {
  persistSession({
    access_token: 'access-test',
    refresh_token: 'refresh-test',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      username: 'admin',
      role: 'ADMINISTRATOR',
      status: 'ACTIVE',
      ...(mustChange ? { must_change_password: true } : {}),
    },
  })
}

describe('password-change-gate', () => {
  afterEach(() => {
    clearSession()
  })

  it('extracts PASSWORD_CHANGE_REQUIRED from FastAPI detail payloads', () => {
    expect(
      extractHttpErrorCode({
        detail: {
          error_code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must change your password before using this resource.',
        },
      }),
    ).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('marks session without clearing tokens', () => {
    seedSession(false)
    markSessionRequiresPasswordChange()
    const s = readSession()
    expect(s?.access_token).toBe('access-test')
    expect(s?.refresh_token).toBe('refresh-test')
    expect(s?.user.must_change_password).toBe(true)
  })

  it('clears must_change_password when whoami reports false', () => {
    persistSession({
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      user: { username: 'admin', role: 'ADMINISTRATOR', status: 'ACTIVE', must_change_password: true },
    })
    syncSessionFromWhoAmI({
      username: 'admin',
      role: 'ADMINISTRATOR',
      must_change_password: false,
    })
    expect(readSession()?.user.must_change_password).toBeUndefined()
  })

  it('syncs must_change_password from whoami', () => {
    seedSession(false)
    syncSessionFromWhoAmI({
      username: 'admin',
      role: 'ADMINISTRATOR',
      authenticated: true,
      must_change_password: true,
    })
    expect(readSession()?.user.must_change_password).toBe(true)
  })

  it('detects PasswordChangeRequiredError instances', () => {
    expect(errorIndicatesPasswordChangeRequired(new PasswordChangeRequiredError())).toBe(true)
    expect(errorIndicatesPasswordChangeRequired(new Error('403: [PASSWORD_CHANGE_REQUIRED] blocked'))).toBe(true)
  })

  it('persists under gdc_platform_session_v1', () => {
    seedSession(false)
    markSessionRequiresPasswordChange()
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    expect(raw).toContain('must_change_password')
    expect(raw).toContain('access-test')
  })
})
