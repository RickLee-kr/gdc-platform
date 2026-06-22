/**
 * UX simplification before/after capture (after state).
 * Run: cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:18443 npx playwright test e2e/wizard-v3-ux-simplify-screenshots.spec.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { expectAppShell } from './helpers/auth-flow'

const VALIDATION_PASSWORD = process.env.PLAYWRIGHT_E2E_PASSWORD?.trim() || 'GdcSmokeE2e!2026'

async function signInForValidation(page: Page, request: APIRequestContext) {
  const loginRes = await request.post('/api/v1/auth/login', {
    data: { username: 'admin', password: VALIDATION_PASSWORD },
  })
  if (!loginRes.ok()) throw new Error(`Login failed: HTTP ${loginRes.status()}`)
  let session = (await loginRes.json()) as {
    access_token: string
    refresh_token: string
    expires_at: string
    user: { username: string; role: string; status: string; must_change_password?: boolean }
  }
  if (session.user?.must_change_password) {
    const changeRes = await request.post('/api/v1/auth/change-password', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: {
        current_password: VALIDATION_PASSWORD,
        new_password: VALIDATION_PASSWORD,
        confirm_new_password: VALIDATION_PASSWORD,
      },
    })
    if (!changeRes.ok()) throw new Error(`Password change failed: HTTP ${changeRes.status()}`)
    const relogin = await request.post('/api/v1/auth/login', {
      data: { username: 'admin', password: VALIDATION_PASSWORD },
    })
    session = (await relogin.json()) as typeof session
  }
  await page.goto('/')
  await page.evaluate(
    ({ sessionPayload }) => {
      localStorage.setItem('gdc_platform_session_v1', JSON.stringify(sessionPayload))
      localStorage.setItem('gdc-platform-persona', 'connector')
    },
    {
      sessionPayload: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: session.user,
      },
    },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await expectAppShell(page)
}

const OUT_DIR = path.resolve('validation-output/wizard-v3-ux-simplify/after')

async function shot(page: import('@playwright/test').Page, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true })
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
})

test('capture simplified Connect and Sample tabs', async ({ page, request }) => {
  await signInForValidation(page, request)
  await page.route('**/api/v1/runtime/api-test/http', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        request: { method: 'GET', url: 'http://127.0.0.1/e2e', headers_masked: {} },
        response: {
          status_code: 200,
          latency_ms: 12,
          headers: { 'content-type': 'application/json' },
          raw_body: JSON.stringify({ Records: [{ eventTime: '2024-01-01', eventID: 'e1' }] }),
          parsed_json: { Records: [{ eventTime: '2024-01-01', eventID: 'e1' }] },
          content_type: 'application/json',
        },
        analysis: {
          response_summary: { root_type: 'object', approx_size_bytes: 64, top_level_keys: ['Records'], item_count_root: null, truncation: null },
          detected_arrays: [{ path: '$.Records', count: 1, confidence: 0.9, reason: 'array' }],
          detected_checkpoint_candidates: [],
          sample_event: { eventTime: '2024-01-01', eventID: 'e1' },
          selected_event_array_default: '$.Records',
          flat_preview_fields: ['$.eventTime'],
          preview_error: null,
        },
      }),
    })
  })

  await page.goto('/streams/new', { waitUntil: 'networkidle' })
  const select = page.getByTestId('wizard-saved-connector-select')
  if ((await select.count()) > 0) {
    const dev = select.locator('option', { hasText: '[DEV VALIDATION]' }).first()
    if ((await dev.count()) > 0) {
      const value = await dev.getAttribute('value')
      if (value) await select.selectOption(value)
      else await select.selectOption({ index: 1 })
    } else if ((await select.locator('option').count()) > 1) {
      await select.selectOption({ index: 1 })
    }
  }

  await expect(page.getByTestId('wizard-step-connect')).toBeVisible()
  await expect(page.getByTestId('wizard-connect-tab-connector')).toBeVisible()
  await expect(page.getByTestId('wizard-connect-tab-request')).toBeVisible()
  await expect(page.getByTestId('wizard-connect-tab-advanced')).toBeVisible()
  await expect(page.getByTestId('wizard-connect-tab-authentication')).toHaveCount(0)
  await shot(page, '01-connect-tabs')

  await page.locator('#wizard-stepper button').filter({ hasText: 'Sample' }).click()
  await page.getByTestId('wizard-sample-tab-run_test').click()
  await page.getByRole('button', { name: 'Run Test', exact: true }).first().click()
  await expect(page.getByTestId('wizard-run-test-success')).toBeVisible({ timeout: 30_000 })
  await shot(page, '02-sample-tabs-run-test')

  await page.getByTestId('wizard-sample-tab-record_selection').click()
  await expect(page.getByTestId('wizard-record-selection-json-tree')).toBeVisible({ timeout: 20_000 })
  await shot(page, '03-record-selection-tree')

  await page.getByRole('button', { name: 'Formatted' }).click()
  await expect(page.getByText('Formatted Response')).toBeVisible()
  await shot(page, '04-record-selection-formatted')
})
