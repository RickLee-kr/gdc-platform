/**
 * Targeted Governance Workspace browser check (mocked APIs — no full E2E stack).
 * Verifies page render + bounded network fan-out for selected-stream snapshot load.
 *
 * Run:
 *   cd frontend && npx playwright test -c playwright.config.governance-workspace.ts
 */
import { expect, test } from '@playwright/test'

test.describe('Governance Workspace snapshot retrieval', () => {
  test('loads catalogs once and one workspace-snapshot for the selected stream', async ({ page }) => {
    const counts = {
      streams: 0,
      routes: 0,
      snapshot: 0,
      effectiveFanout: 0,
      authMe: 0,
    }

    await page.addInitScript(() => {
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      localStorage.setItem(
        'gdc_platform_session_v1',
        JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_at: expires,
          user: {
            username: 'admin',
            role: 'ADMINISTRATOR',
            status: 'ACTIVE',
            must_change_password: false,
            capabilities: {
              governance_read: true,
              governance_dashboard_read: true,
            },
          },
        }),
      )
    })

    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url()
      if (url.includes('/api/v1/auth/me') || url.includes('/api/v1/auth/whoami')) {
        counts.authMe += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            username: 'admin',
            role: 'ADMINISTRATOR',
            status: 'ACTIVE',
            must_change_password: false,
            capabilities: {
              governance_read: true,
              governance_dashboard_read: true,
            },
          }),
        })
        return
      }
      if (/\/api\/v1\/streams\/?(\?|$)/.test(url) || url.endsWith('/api/v1/streams/')) {
        counts.streams += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 10, name: 'Stream A', status: 'RUNNING' }]),
        })
        return
      }
      if (/\/api\/v1\/routes\/?(\?|$)/.test(url) || url.endsWith('/api/v1/routes/')) {
        counts.routes += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 42, name: 'Route A', stream_id: 10, destination_id: 1, enabled: true },
            { id: 43, name: 'Route B', stream_id: 10, destination_id: 2, enabled: true },
          ]),
        })
        return
      }
      if (url.includes('/governance/workspace-snapshot')) {
        counts.snapshot += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            stream_id: 10,
            route_count: 2,
            routes: [42, 43].map((routeId) => ({
              route_id: routeId,
              route_name: `Route #${routeId}`,
              transform: {
                route_id: routeId,
                stream_id: 10,
                persisted_source: 'stream',
                mapping_source: 'stream',
                enrichment_source: 'stream',
                fallback_used: true,
                mapping_count: 0,
                enrichment_count: 0,
                processing_status: 'Inherited',
                message: 'ok',
              },
              protection: {
                route_id: routeId,
                stream_id: 10,
                persisted_source: 'stream',
                fallback_used: true,
                rule_count: 1,
                processing_status: 'Inherited',
                message: 'ok',
              },
              classification: {
                route_id: routeId,
                stream_id: 10,
                persisted_source: 'stream',
                fallback_used: true,
                rule_count: 1,
                processing_status: 'Inherited',
                message: 'ok',
              },
              policy: {
                route_id: routeId,
                stream_id: 10,
                persisted_source: 'stream',
                fallback_used: true,
                rule_count: 1,
                processing_status: 'Inherited',
              },
            })),
          }),
        })
        return
      }
      if (/\/runtime\/routes\/\d+\/(transform|protection|classification|policy)\/effective/.test(url)) {
        counts.effectiveFanout += 1
        await route.fulfill({ status: 500, body: 'fanout should not be called' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/governance/workspace')
    await expect(page.getByTestId('governance-workspace-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('governance-workspace-route-row-42')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('governance-workspace-route-row-43')).toBeVisible()

    // Vite/React StrictMode may double-invoke effects in DEV; allow at most 2 snapshot calls.
    expect(counts.streams).toBeGreaterThanOrEqual(1)
    expect(counts.routes).toBeGreaterThanOrEqual(1)
    expect(counts.snapshot).toBeGreaterThanOrEqual(1)
    expect(counts.snapshot).toBeLessThanOrEqual(2)
    expect(counts.effectiveFanout).toBe(0)
  })
})
