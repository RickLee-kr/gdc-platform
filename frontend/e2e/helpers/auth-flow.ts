import type { APIRequestContext, Page } from '@playwright/test'

export const E2E_USERNAME = process.env.PLAYWRIGHT_E2E_USERNAME?.trim() || 'admin'
export const E2E_BOOTSTRAP_PASSWORD = process.env.PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD?.trim() || 'admin'
/** Password used after bootstrap change and for steady-state login. */
export const E2E_PASSWORD = process.env.PLAYWRIGHT_E2E_PASSWORD?.trim() || 'GdcSmokeE2e!2026'

export type AuthProbeMode = 'bootstrap' | 'steady' | 'unavailable'

export type AuthProbeResult = {
  mode: AuthProbeMode
  mustChangePassword: boolean
  accessToken?: string
}

/** Password to use after the initial sign-in flow completes. */
export function sessionPassword(probe: AuthProbeResult): string {
  if (probe.mode === 'bootstrap' && probe.mustChangePassword) return E2E_PASSWORD
  if (probe.mode === 'bootstrap') return E2E_BOOTSTRAP_PASSWORD
  return E2E_PASSWORD
}

type LoginResponse = {
  access_token?: string
  user?: { must_change_password?: boolean }
  detail?: { message?: string; error_code?: string }
}

async function apiLogin(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<{ ok: true; body: LoginResponse } | { ok: false }> {
  const res = await request.post('/api/v1/auth/login', {
    data: { username, password },
  })
  if (!res.ok()) return { ok: false }
  const body = (await res.json()) as LoginResponse
  if (!body.access_token) return { ok: false }
  return { ok: true, body }
}

/** Probe credentials against the live API (no mocks). */
export async function probeAuthMode(request: APIRequestContext): Promise<AuthProbeResult> {
  const bootstrap = await apiLogin(request, E2E_USERNAME, E2E_BOOTSTRAP_PASSWORD)
  if (bootstrap.ok) {
    return {
      mode: 'bootstrap',
      mustChangePassword: bootstrap.body.user?.must_change_password === true,
      accessToken: bootstrap.body.access_token,
    }
  }

  const steady = await apiLogin(request, E2E_USERNAME, E2E_PASSWORD)
  if (steady.ok) {
    return {
      mode: 'steady',
      mustChangePassword: steady.body.user?.must_change_password === true,
      accessToken: steady.body.access_token,
    }
  }

  return { mode: 'unavailable', mustChangePassword: false }
}

export async function clearClientSession(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('gdc_platform_session_v1')
    localStorage.removeItem('gdc_platform_ui_role')
    localStorage.removeItem('gdc_platform_ui_username')
  })
}

export async function expectLoginScreen(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Welcome to DataRelay' }).waitFor({ state: 'visible' })
}

export async function uiLogin(page: Page, username: string, password: string): Promise<void> {
  await expectLoginScreen(page)
  await page.locator('#platform-login-username').fill(username)
  await page.locator('#platform-login-password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
}

export async function uiChangeDefaultPassword(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await page.getByRole('heading', { name: 'Change default password' }).waitFor({ state: 'visible' })
  await page.locator('#force-pw-current').fill(currentPassword)
  await page.locator('#force-pw-new').fill(newPassword)
  await page.locator('#force-pw-confirm').fill(newPassword)
  await page.getByRole('button', { name: 'Update password and sign in again' }).click()
  await expectLoginScreen(page)
}

export async function expectDashboard(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 2, name: 'Operations Center' }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByText('Active Streams').waitFor({ state: 'visible' })
}

export async function expectAppShell(page: Page): Promise<void> {
  const nav = page.getByRole('complementary', { name: 'Primary navigation' })
  await nav.waitFor({ state: 'visible' })
  await nav.getByRole('button', { name: 'Operations Center' }).waitFor({ state: 'visible' })
  await nav.getByRole('button', { name: 'Runtime' }).waitFor({ state: 'visible' })
  await page.getByText(E2E_USERNAME, { exact: true }).waitFor({ state: 'visible' })
}

export async function openRuntimePage(page: Page): Promise<void> {
  const nav = page.getByRole('complementary', { name: 'Primary navigation' })
  await nav.getByRole('button', { name: 'Runtime' }).click()
  await page.getByRole('heading', { level: 1, name: 'Runtime' }).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: 'Streams' }).waitFor({ state: 'visible' })
}

export async function readAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('gdc_platform_session_v1')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { access_token?: string }
      return typeof parsed.access_token === 'string' ? parsed.access_token : null
    } catch {
      return null
    }
  })
  if (!token) throw new Error('Expected JWT in gdc_platform_session_v1 after login')
  return token
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expectLoginScreen(page)
}
