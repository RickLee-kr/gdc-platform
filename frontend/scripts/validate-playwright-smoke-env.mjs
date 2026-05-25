#!/usr/bin/env node
/**
 * Playwright smoke preflight: validate that the environment is in a state
 * where `npm run test:playwright-smoke` can produce a useful result.
 *
 * Exit codes:
 *   0  PASS or PASS_WITH_WARNINGS  (smoke may still skip with a clear reason)
 *   1  FAIL                        (something is wrong with the preflight env)
 *
 * This script is intentionally dependency-free (node:fetch, node:process only).
 */
import {
  formatSkipReason,
  resolveAuthEnv,
  summarizeChecks,
  checkResult,
} from './lib/playwright-smoke-env.mjs'

const PROBE_TIMEOUT_MS = Number.parseInt(process.env.PLAYWRIGHT_SMOKE_PREFLIGHT_TIMEOUT_MS || '5000', 10)

function color(code, text) {
  if (!process.stdout.isTTY) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

const COLORS = { PASS: 32, WARN: 33, FAIL: 31, INFO: 36 }

function emit(level, message, detail) {
  const tag = color(COLORS[level] ?? 0, level.padEnd(4))
  process.stdout.write(`[${tag}] ${message}`)
  if (detail) process.stdout.write(`\n        ${detail}`)
  process.stdout.write('\n')
}

async function probeHttp(label, url, expectedStatuses) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (expectedStatuses && !expectedStatuses.includes(res.status)) {
      return checkResult('WARN', `${label} responded ${res.status} at ${url}`, `expected one of ${expectedStatuses.join(', ')}`)
    }
    return checkResult('PASS', `${label} reachable at ${url}`, `HTTP ${res.status}`)
  } catch (err) {
    return checkResult('FAIL', `${label} unreachable at ${url}`, String(err?.message || err))
  }
}

async function probeLogin(env, username, password, passwordSource) {
  const loginUrl = `${env.apiBaseUrl}/api/v1/auth/login`
  let res
  try {
    res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (err) {
    return {
      check: checkResult('FAIL', `login endpoint unreachable at ${loginUrl}`, String(err?.message || err)),
      probe: { mode: 'api_unreachable', detail: String(err?.message || err), triedUsername: username, triedPasswordSource: passwordSource },
    }
  }

  let body = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  if (res.status === 200 && typeof body?.access_token === 'string' && body.access_token.length > 0) {
    const mustChange = Boolean(body?.user?.must_change_password)
    if (mustChange) {
      return {
        check: checkResult(
          'WARN',
          `login OK for "${username}" but must_change_password=true`,
          `password source: ${passwordSource}`,
        ),
        probe: { mode: 'must_change_password', triedUsername: username, triedPasswordSource: passwordSource },
      }
    }
    return {
      check: checkResult(
        'PASS',
        `login OK for "${username}"`,
        `password source: ${passwordSource}`,
      ),
      probe: { mode: 'ready', triedUsername: username, triedPasswordSource: passwordSource },
    }
  }

  if (res.status === 400 || res.status === 401) {
    return {
      check: checkResult(
        'WARN',
        `login rejected for "${username}" (HTTP ${res.status})`,
        `password source: ${passwordSource}; smoke will skip with clear reason`,
      ),
      probe: { mode: 'invalid_credentials', triedUsername: username, triedPasswordSource: passwordSource, detail: `HTTP ${res.status}` },
    }
  }

  return {
    check: checkResult(
      'WARN',
      `login returned unexpected HTTP ${res.status} for "${username}"`,
      `password source: ${passwordSource}`,
    ),
    probe: { mode: 'invalid_credentials', triedUsername: username, triedPasswordSource: passwordSource, detail: `HTTP ${res.status}` },
  }
}

async function main() {
  const env = resolveAuthEnv(process.env)

  emit('INFO', 'Playwright smoke preflight')
  emit('INFO', `username = "${env.username}" (source: ${env.usernameSource})`)
  emit('INFO', `password source = ${env.passwordSource}`)
  emit('INFO', `api      = ${env.apiBaseUrl}`)
  emit('INFO', `frontend = ${env.frontendBaseUrl}`)

  const checks = []

  // Frontend reachability — vite is also auto-started by playwright.config.smoke.ts,
  // so an absent dev server is a WARN (recoverable), not a FAIL.
  const frontendProbe = await probeHttp('frontend', env.frontendBaseUrl)
  const frontendCheck = frontendProbe.level === 'FAIL'
    ? checkResult(
        'WARN',
        `frontend not yet running at ${env.frontendBaseUrl}`,
        `${frontendProbe.detail || 'unreachable'} — playwright.config.smoke.ts will start vite automatically`,
      )
    : frontendProbe
  emit(frontendCheck.level, frontendCheck.message, frontendCheck.detail)
  checks.push(frontendCheck)

  // API /health
  const healthCheck = await probeHttp('API /health', `${env.apiBaseUrl}/health`, [200])
  emit(healthCheck.level, healthCheck.message, healthCheck.detail)
  checks.push(healthCheck)
  if (healthCheck.level === 'FAIL') {
    emit('FAIL', formatSkipReason({ mode: 'api_unreachable', detail: healthCheck.detail }, process.env))
    return summarizeAndExit(checks)
  }

  // Require auth: a healthy smoke environment returns 401 on unauthenticated /runtime/status.
  const statusCheck = await (async () => {
    const url = `${env.apiBaseUrl}/api/v1/runtime/status`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (res.status === 401) {
        return checkResult('PASS', `API requires auth (GET /runtime/status → 401)`)
      }
      return checkResult(
        'WARN',
        `API does not require auth (GET /runtime/status → ${res.status})`,
        'Smoke expects REQUIRE_AUTH=true; restart API with REQUIRE_AUTH=true',
      )
    } catch (err) {
      return checkResult('WARN', `could not probe ${url}`, String(err?.message || err))
    }
  })()
  emit(statusCheck.level, statusCheck.message, statusCheck.detail)
  checks.push(statusCheck)

  // Auth: try explicit creds first, then bootstrap fallback (if allowed).
  let loginCheck
  let probeForSkip
  if (env.explicitPassword) {
    const { check, probe } = await probeLogin(env, env.username, env.explicitPassword, 'PLAYWRIGHT_E2E_PASSWORD')
    loginCheck = check
    probeForSkip = probe
  } else if (env.allowBootstrap) {
    const { check, probe } = await probeLogin(env, env.username, env.bootstrapPassword, env.passwordSource)
    loginCheck = check
    probeForSkip = probe
  } else {
    loginCheck = checkResult(
      'WARN',
      `no usable credentials (PLAYWRIGHT_E2E_PASSWORD unset, bootstrap fallback disabled)`,
    )
    probeForSkip = { mode: 'no_credentials' }
  }
  emit(loginCheck.level, loginCheck.message, loginCheck.detail)
  checks.push(loginCheck)

  if (probeForSkip && probeForSkip.mode !== 'ready') {
    emit('INFO', formatSkipReason(probeForSkip, process.env))
  }

  return summarizeAndExit(checks)
}

function summarizeAndExit(checks) {
  const { result, exitCode } = summarizeChecks(checks)
  const tag = color(result === 'FAIL' ? COLORS.FAIL : result === 'PASS' ? COLORS.PASS : COLORS.WARN, result)
  process.stdout.write(`\nPreflight result: ${tag}\n`)
  process.exit(exitCode)
}

main().catch((err) => {
  // Defensive: never let an unexpected throw masquerade as a smoke failure.
  emit('FAIL', 'Playwright smoke preflight crashed', String(err?.stack || err))
  process.exit(1)
})
