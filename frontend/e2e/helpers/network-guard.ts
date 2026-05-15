import type { Page, Response } from '@playwright/test'

const IGNORED_CONSOLE_PATTERNS = [
  /favicon\.ico/i,
  /Failed to load resource.*favicon/i,
]

const IGNORED_API_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
]

export type NetworkGuard = {
  markAuthenticated: () => void
  assertClean: () => void
}

function shouldIgnoreApiFailure(url: string, status: number): boolean {
  if (status < 400) return true
  return IGNORED_API_PATHS.some((p) => url.includes(p))
}

export function attachNetworkGuard(page: Page): NetworkGuard {
  const consoleErrors: string[] = []
  const apiFailures: string[] = []
  let authenticated = false

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))) return
    consoleErrors.push(text)
  })

  page.on('response', (response: Response) => {
    if (!authenticated) return
    const url = response.url()
    if (!url.includes('/api/')) return
    const status = response.status()
    if (shouldIgnoreApiFailure(url, status)) return
    if (status >= 400) {
      apiFailures.push(`${response.request().method()} ${url} → ${status}`)
    }
  })

  return {
    markAuthenticated() {
      authenticated = true
    },
    assertClean() {
      if (consoleErrors.length > 0) {
        throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`)
      }
      if (apiFailures.length > 0) {
        throw new Error(`Authenticated API failures:\n${apiFailures.join('\n')}`)
      }
    },
  }
}
