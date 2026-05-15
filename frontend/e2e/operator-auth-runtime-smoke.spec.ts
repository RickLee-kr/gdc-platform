import { expect, test } from '@playwright/test'
import {
  E2E_BOOTSTRAP_PASSWORD,
  E2E_PASSWORD,
  E2E_USERNAME,
  clearClientSession,
  expectAppShell,
  expectDashboard,
  openRuntimePage,
  probeAuthMode,
  readAccessToken,
  sessionPassword,
  signOut,
  uiChangeDefaultPassword,
  uiLogin,
} from './helpers/auth-flow'
import { attachNetworkGuard } from './helpers/network-guard'

test.describe.configure({ mode: 'serial' })

test.describe('Operator auth + runtime smoke (live JWT)', () => {
  test('login, password change when required, AppShell, runtime, bearer API, logout cycle', async ({
    page,
    request,
  }) => {
    const probe = await probeAuthMode(request)
    test.skip(
      probe.mode === 'unavailable',
      `Cannot authenticate as ${E2E_USERNAME}. Set PLAYWRIGHT_E2E_PASSWORD (steady state) or reset bootstrap ` +
        `(admin/admin + must_change_password). Tried bootstrap and "${E2E_PASSWORD}".`,
    )

    const guard = attachNetworkGuard(page)
    const loginPassword = sessionPassword(probe)
    await clearClientSession(page)

    await test.step('runtime/status rejects unauthenticated access', async () => {
      const res = await request.get('/api/v1/runtime/status')
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body).toMatchObject({
        detail: expect.objectContaining({ error_code: 'AUTH_REQUIRED' }),
      })
    })

    await test.step('sign in through the login UI', async () => {
      if (probe.mode === 'bootstrap') {
        await uiLogin(page, E2E_USERNAME, E2E_BOOTSTRAP_PASSWORD)
        if (probe.mustChangePassword) {
          await uiChangeDefaultPassword(page, E2E_BOOTSTRAP_PASSWORD, E2E_PASSWORD)
          await uiLogin(page, E2E_USERNAME, E2E_PASSWORD)
        }
      } else {
        await uiLogin(page, E2E_USERNAME, loginPassword)
      }
      guard.markAuthenticated()
    })

    await test.step('Operations Center dashboard and sidebar', async () => {
      await expectDashboard(page)
      await expectAppShell(page)
    })

    await test.step('runtime page loads with authenticated runtime APIs', async () => {
      const dashboardOk = page.waitForResponse(
        (r) => r.url().includes('/api/v1/runtime/dashboard/summary') && r.status() === 200,
        { timeout: 20_000 },
      )
      await openRuntimePage(page)
      await dashboardOk
    })

    await test.step('GET /api/v1/runtime/status with Bearer JWT', async () => {
      const token = await readAccessToken(page)
      const res = await request.get('/api/v1/runtime/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('schema_ready')
      expect(body).toHaveProperty('database')
    })

    await test.step('logout and sign in again', async () => {
      await signOut(page)
      await uiLogin(page, E2E_USERNAME, loginPassword)
      await expectDashboard(page)
      await expectAppShell(page)
    })

    guard.assertClean()
  })
})
