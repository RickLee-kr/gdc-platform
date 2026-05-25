/**
 * Shared, dependency-free helpers used by both the Playwright smoke preflight
 * (`frontend/scripts/validate-playwright-smoke-env.mjs`) and the smoke spec auth
 * flow. Keep this file pure-JS so it is consumable from both Node CLI scripts
 * and Playwright tests without a TypeScript build step.
 */

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'
export const DEFAULT_FRONTEND_BASE_URL = 'http://127.0.0.1:4173'
export const DEFAULT_USERNAME = 'admin'
export const BOOTSTRAP_DEFAULT_PASSWORD = 'admin'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])

/** Normalize a base URL: trim trailing slashes, fall back to default. */
export function normalizeBaseUrl(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const resolved = raw || fallback
  return resolved.replace(/\/+$/, '')
}

function parseBool(raw, defaultValue) {
  if (raw === undefined || raw === null) return defaultValue
  const v = String(raw).trim().toLowerCase()
  if (TRUTHY.has(v)) return true
  if (FALSY.has(v)) return false
  return defaultValue
}

/**
 * Resolve all Playwright smoke env inputs into a single, explainable struct.
 * `passwordSource` documents which env produced the chosen password so skip
 * messages can name it without leaking the actual value.
 */
export function resolveAuthEnv(env = process.env) {
  const usernameEnv = env.PLAYWRIGHT_E2E_USERNAME
  const username = (usernameEnv && usernameEnv.trim()) || DEFAULT_USERNAME
  const usernameSource = usernameEnv && usernameEnv.trim()
    ? 'PLAYWRIGHT_E2E_USERNAME'
    : `default(${DEFAULT_USERNAME})`

  const explicitPasswordRaw = env.PLAYWRIGHT_E2E_PASSWORD
  const explicitPassword = (explicitPasswordRaw && explicitPasswordRaw.trim()) || ''

  const bootstrapPasswordRaw = env.PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD
  const bootstrapPassword = (bootstrapPasswordRaw && bootstrapPasswordRaw.trim()) || BOOTSTRAP_DEFAULT_PASSWORD

  const allowBootstrap = parseBool(env.PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK, true)

  let passwordSource
  if (explicitPassword) {
    passwordSource = 'PLAYWRIGHT_E2E_PASSWORD'
  } else if (allowBootstrap) {
    passwordSource = bootstrapPasswordRaw && bootstrapPasswordRaw.trim()
      ? 'PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD'
      : `bootstrap_default(${BOOTSTRAP_DEFAULT_PASSWORD}/${BOOTSTRAP_DEFAULT_PASSWORD})`
  } else {
    passwordSource = 'none'
  }

  return {
    username,
    usernameSource,
    explicitPassword,
    bootstrapPassword,
    allowBootstrap,
    passwordSource,
    hasUsablePassword: Boolean(explicitPassword) || allowBootstrap,
    apiBaseUrl: normalizeBaseUrl(env.PLAYWRIGHT_API_BASE_URL, DEFAULT_API_BASE_URL),
    frontendBaseUrl: normalizeBaseUrl(env.PLAYWRIGHT_BASE_URL, DEFAULT_FRONTEND_BASE_URL),
  }
}

/** Result of running a single preflight probe. */
export function checkResult(level, message, detail) {
  return { level, message, detail: detail ?? null }
}

/**
 * Single source of truth for "why did Playwright smoke skip?". The smoke spec
 * passes its probe result here; the message names the precise blocking
 * condition (API reachability vs credentials vs password change required).
 */
export function formatSkipReason(probe, env = process.env) {
  const auth = resolveAuthEnv(env)
  const triedUsername = probe?.triedUsername || auth.username
  const triedPasswordSource = probe?.triedPasswordSource || auth.passwordSource

  switch (probe?.mode) {
    case 'api_unreachable':
      return (
        `Playwright smoke skipped: API at ${auth.apiBaseUrl} not reachable (${probe.detail || 'network error'}). ` +
        'Start the dev platform (./scripts/dev/bootstrap-dev-platform.sh) before retrying.'
      )
    case 'frontend_unreachable':
      return (
        `Playwright smoke skipped: frontend at ${auth.frontendBaseUrl} not reachable (${probe.detail || 'network error'}). ` +
        'The vite webServer in playwright.config.smoke.ts should start it automatically; check the smoke webServer output.'
      )
    case 'invalid_credentials':
      return (
        `Playwright smoke skipped: API rejected login for username "${triedUsername}" ` +
        `(password source: ${triedPasswordSource}). ` +
        'Set PLAYWRIGHT_E2E_USERNAME and PLAYWRIGHT_E2E_PASSWORD to the operator credentials, ' +
        'or run scripts/admin/reset-admin-password.sh to align the admin password.'
      )
    case 'must_change_password':
      return (
        `Playwright smoke skipped: bootstrap admin login succeeded but must_change_password=true and ` +
        `PLAYWRIGHT_E2E_PASSWORD is not set. ` +
        'Set PLAYWRIGHT_E2E_PASSWORD to a steady password and rerun; the smoke spec will change ' +
        'the bootstrap password to it on first login.'
      )
    case 'no_credentials':
      return (
        `Playwright smoke skipped: no usable credentials. ` +
        `Set PLAYWRIGHT_E2E_PASSWORD or allow the admin/admin bootstrap fallback ` +
        `(PLAYWRIGHT_E2E_ALLOW_BOOTSTRAP_FALLBACK=true).`
      )
    case 'auth_disabled':
      return (
        `Playwright smoke skipped: API responded but does not require auth ` +
        `(GET /api/v1/runtime/status did not return 401). ` +
        'The smoke suite expects REQUIRE_AUTH=true. Restart the API with REQUIRE_AUTH=true.'
      )
    default:
      return `Playwright smoke skipped: ${probe?.detail || 'unknown reason'}`
  }
}

/**
 * Aggregate preflight checks into a final {result, exitCode} verdict.
 *
 * - result: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL'
 * - exitCode: 0 on PASS/PASS_WITH_WARNINGS, 1 on FAIL.
 *
 * Credentials problems are intentionally WARN (not FAIL) because the smoke
 * spec is the authoritative skip gate — preflight should remain a diagnostic.
 */
export function summarizeChecks(checks) {
  let hasFail = false
  let hasWarn = false
  for (const c of checks) {
    if (c.level === 'FAIL') hasFail = true
    if (c.level === 'WARN') hasWarn = true
  }
  if (hasFail) return { result: 'FAIL', exitCode: 1 }
  if (hasWarn) return { result: 'PASS_WITH_WARNINGS', exitCode: 0 }
  return { result: 'PASS', exitCode: 0 }
}
