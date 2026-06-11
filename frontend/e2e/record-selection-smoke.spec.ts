/**
 * Minimal Playwright smoke for Record Selection → Mapping workflow.
 *
 * Reliability contract (see docs/testing/e2e-functional-regression-matrix.md):
 *   - All skip messages must explain which condition triggered the skip.
 *   - Auth is resolved via probeAuthMode + signInForSmoke (no hidden assumptions).
 *   - Preflight: `npm run validate:playwright-smoke` prints the same diagnostics.
 *
 * Run: `cd frontend && npm run test:playwright-smoke`
 */
import { expect, test } from '@playwright/test'
import {
  expectAppShell,
  formatProbeSkipReason,
  probeAuthMode,
  signInForSmoke,
} from './helpers/auth-flow'

function stepButton(page: import('@playwright/test').Page, title: string) {
  return page.locator('#wizard-stepper button').filter({ hasText: title })
}

/** 9-step wizard: open Preview (Record Selection) after sample load or via stepper. */
async function ensurePreviewStep(page: import('@playwright/test').Page) {
  const recordSelection = page.getByRole('heading', { name: 'Record Selection' })
  if (await recordSelection.isVisible().catch(() => false)) return
  await stepButton(page, 'JSON Preview').click()
  await expect(recordSelection).toBeVisible({ timeout: 15_000 })
}

async function expectMappingStep(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Field Mapping' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('tab', { name: /Basic · JSONPath/i })).toBeVisible()
}

test.describe('Record Selection smoke', () => {
  test('login, wizard record selection, mapping validation, run control reachable', async ({ page, request }) => {
    const probe = await probeAuthMode(request)
    if (
      probe.mode !== 'ready' &&
      !(probe.mode === 'must_change_password' && probe.steadyPassword)
    ) {
      const reason = formatProbeSkipReason(probe)
      // Make the skip reason visible to the operator regardless of reporter.
      console.log(`[smoke-skip] ${reason}`)
      test.skip(true, reason)
      return
    }

    console.log(
      `[smoke] auth ready: username="admin" mode=${probe.mode} passwordSource=${probe.passwordSource}`,
    )

    await signInForSmoke(page, probe)
    await expectAppShell(page)

    await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Streams' }).click()
    await page.getByRole('link', { name: 'New Stream' }).click()
    await expect(page.locator('#wizard-stepper')).toBeVisible({ timeout: 20_000 })

    const connectorSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Select connector' }) })
      .first()
    await connectorSelect.selectOption({ index: 1 })

    await stepButton(page, 'API Test').click()
    await page.getByRole('button', { name: 'AWS CloudTrail', exact: true }).click()
    await ensurePreviewStep(page)
    await page.getByRole('button', { name: /\$\.Records · \d+ records/ }).first().click()
    await page.getByRole('button', { name: '$.event', exact: true }).click()
    await expect(page.getByText('$.Records[*].event', { exact: true }).first()).toBeVisible()

    await stepButton(page, 'Mapping').click()
    await expectMappingStep(page)

    await page.getByRole('button', { name: 'Add row' }).click()
    const sourceInput = page.getByLabel('Source JSONPath')
    await sourceInput.fill('$.Records[0].event.eventTime')
    await page.getByPlaceholder('Search mappings…').click()

    await expect(page.getByText('ENVELOPE_RELATIVE_MAPPING_PATH')).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('Mapping paths must be relative to the extracted event, not the raw response envelope.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Search fields' }).fill('eventVersion')
    await expect(page.getByText('eventVersion', { exact: true }).first()).toBeVisible({ timeout: 10_000 })

    await stepButton(page, 'Review').click()
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Streams' }).click()
    const firstStream = page.getByRole('link', { name: /Stream|stream/i }).first()
    if (await firstStream.isVisible().catch(() => false)) {
      await firstStream.click()
      await expect(page.getByRole('button', { name: /Run Now|Run Once/i }).first()).toBeVisible({ timeout: 15_000 })
    } else {
      await expect(page.getByRole('link', { name: 'New Stream' })).toBeVisible()
    }
  })
})
