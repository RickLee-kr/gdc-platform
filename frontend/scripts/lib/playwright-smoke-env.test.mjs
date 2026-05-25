import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_DEFAULT_PASSWORD,
  DEFAULT_API_BASE_URL,
  DEFAULT_FRONTEND_BASE_URL,
  DEFAULT_USERNAME,
  formatSkipReason,
  normalizeBaseUrl,
  resolveAuthEnv,
  summarizeChecks,
} from './playwright-smoke-env.mjs'

describe('resolveAuthEnv', () => {
  it('returns explicit creds when both env vars are set', () => {
    const env = {
      PLAYWRIGHT_E2E_USERNAME: 'opuser',
      PLAYWRIGHT_E2E_PASSWORD: 'StrongPw!2026',
    }
    const result = resolveAuthEnv(env)
    expect(result.username).toBe('opuser')
    expect(result.usernameSource).toBe('PLAYWRIGHT_E2E_USERNAME')
    expect(result.explicitPassword).toBe('StrongPw!2026')
    expect(result.passwordSource).toBe('PLAYWRIGHT_E2E_PASSWORD')
    expect(result.allowBootstrap).toBe(true)
    expect(result.hasUsablePassword).toBe(true)
  })

  it('falls back to admin/admin bootstrap when password is missing', () => {
    const result = resolveAuthEnv({})
    expect(result.username).toBe(DEFAULT_USERNAME)
    expect(result.usernameSource).toBe(`default(${DEFAULT_USERNAME})`)
    expect(result.explicitPassword).toBe('')
    expect(result.bootstrapPassword).toBe(BOOTSTRAP_DEFAULT_PASSWORD)
    expect(result.passwordSource).toMatch(/bootstrap_default/)
    expect(result.allowBootstrap).toBe(true)
    expect(result.hasUsablePassword).toBe(true)
  })

  it('disables bootstrap fallback when PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK=false', () => {
    const result = resolveAuthEnv({
      PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK: 'false',
    })
    expect(result.allowBootstrap).toBe(false)
    expect(result.passwordSource).toBe('none')
    expect(result.hasUsablePassword).toBe(false)
  })

  it('honors PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD override', () => {
    const result = resolveAuthEnv({ PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD: 'seeded' })
    expect(result.bootstrapPassword).toBe('seeded')
    expect(result.passwordSource).toBe('PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD')
  })

  it('normalizes API and frontend base URLs and strips trailing slashes', () => {
    const result = resolveAuthEnv({
      PLAYWRIGHT_API_BASE_URL: 'http://api.local/  ',
      PLAYWRIGHT_BASE_URL: 'http://ui.local/// ',
    })
    expect(result.apiBaseUrl).toBe('http://api.local')
    expect(result.frontendBaseUrl).toBe('http://ui.local')
  })

  it('uses defaults when env values are blank strings', () => {
    const result = resolveAuthEnv({ PLAYWRIGHT_API_BASE_URL: '   ', PLAYWRIGHT_BASE_URL: '' })
    expect(result.apiBaseUrl).toBe(DEFAULT_API_BASE_URL)
    expect(result.frontendBaseUrl).toBe(DEFAULT_FRONTEND_BASE_URL)
  })
})

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes and uses fallback when blank', () => {
    expect(normalizeBaseUrl('http://x/', 'http://fallback')).toBe('http://x')
    expect(normalizeBaseUrl('', 'http://fallback')).toBe('http://fallback')
    expect(normalizeBaseUrl(undefined, 'http://fallback')).toBe('http://fallback')
  })
})

describe('formatSkipReason', () => {
  it('explains API unreachable with the configured base URL', () => {
    const msg = formatSkipReason(
      { mode: 'api_unreachable', detail: 'ECONNREFUSED' },
      { PLAYWRIGHT_API_BASE_URL: 'http://api.example' },
    )
    expect(msg).toContain('http://api.example')
    expect(msg).toContain('ECONNREFUSED')
    expect(msg).toContain('bootstrap-dev-platform.sh')
  })

  it('explains invalid credentials and names the password source', () => {
    const msg = formatSkipReason(
      { mode: 'invalid_credentials', triedUsername: 'admin', triedPasswordSource: 'PLAYWRIGHT_E2E_PASSWORD' },
      {},
    )
    expect(msg).toContain('username "admin"')
    expect(msg).toContain('PLAYWRIGHT_E2E_PASSWORD')
    expect(msg).toContain('reset-admin-password.sh')
  })

  it('explains must_change_password with steady-password remediation', () => {
    const msg = formatSkipReason({ mode: 'must_change_password' }, {})
    expect(msg).toContain('must_change_password=true')
    expect(msg).toContain('PLAYWRIGHT_E2E_PASSWORD')
  })

  it('explains auth_disabled when the API is not requiring auth', () => {
    const msg = formatSkipReason({ mode: 'auth_disabled' }, {})
    expect(msg).toContain('REQUIRE_AUTH=true')
  })

  it('explains no_credentials when bootstrap fallback is disabled', () => {
    const msg = formatSkipReason({ mode: 'no_credentials' }, {})
    expect(msg).toContain('PLAYWRIGHT_E2E_PASSWORD')
    expect(msg).toContain('PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK')
  })

  it('falls back to a generic message for unknown probe modes', () => {
    const msg = formatSkipReason({ mode: 'something_else', detail: 'oops' }, {})
    expect(msg).toContain('oops')
  })
})

describe('summarizeChecks', () => {
  it('returns PASS when all checks pass', () => {
    expect(summarizeChecks([{ level: 'PASS', message: 'a' }])).toEqual({ result: 'PASS', exitCode: 0 })
  })

  it('returns PASS_WITH_WARNINGS when any check warns', () => {
    expect(
      summarizeChecks([
        { level: 'PASS', message: 'a' },
        { level: 'WARN', message: 'b' },
      ]),
    ).toEqual({ result: 'PASS_WITH_WARNINGS', exitCode: 0 })
  })

  it('returns FAIL with exit 1 when any check fails', () => {
    expect(
      summarizeChecks([
        { level: 'PASS', message: 'a' },
        { level: 'WARN', message: 'b' },
        { level: 'FAIL', message: 'c' },
      ]),
    ).toEqual({ result: 'FAIL', exitCode: 1 })
  })

  it('handles empty input as PASS', () => {
    expect(summarizeChecks([])).toEqual({ result: 'PASS', exitCode: 0 })
  })
})
