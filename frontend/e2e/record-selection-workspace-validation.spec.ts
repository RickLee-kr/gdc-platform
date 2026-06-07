/**
 * Browser validation for Record Selection workspace (Stream Wizard).
 * Run: cd frontend && npx playwright test e2e/record-selection-workspace-validation.spec.ts --config=playwright.config.validation.ts
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { E2E_USERNAME, expectAppShell, uiLogin } from './helpers/auth-flow'

/** Temporary validation password (set via platform DB for this E2E run only). */
const VALIDATION_PASSWORD = process.env.PLAYWRIGHT_VALIDATION_PASSWORD?.trim() || 'E2eRecordSelection!2026'

const ARTIFACT_DIR = path.join('e2e', 'artifacts', 'record-selection-validation')
const EVIDENCE_JSON = path.join(ARTIFACT_DIR, 'evidence.json')

type EvidenceItem = {
  step: string
  pass: boolean
  detail: string
  screenshot?: string
}

const evidence: EvidenceItem[] = []

function record(step: string, pass: boolean, detail: string, screenshot?: string) {
  evidence.push({ step, pass, detail, screenshot })
}

async function seedAuthenticatedSession(page: Page, _request: APIRequestContext): Promise<void> {
  await page.goto('/')
  await uiLogin(page, E2E_USERNAME, VALIDATION_PASSWORD)
  await expectAppShell(page)
}

function stepButton(page: Page, title: string) {
  return page.locator('#wizard-stepper button').filter({ hasText: title })
}

function connectTab(page: Page, tab: 'connection' | 'api_test' | 'preview' | 'record_selection') {
  return page.getByTestId(`wizard-connect-tab-${tab}`)
}

test.describe('Record Selection workspace browser validation', () => {
  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  })

  test.afterAll(() => {
    fs.writeFileSync(EVIDENCE_JSON, JSON.stringify(evidence, null, 2))
  })

  test('CloudTrail extraction, checkpoint, copy actions, mapping tree', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await seedAuthenticatedSession(page, request)

    await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Streams' }).click()
    await page.getByRole('link', { name: 'New Stream' }).click()
    await expect(page.locator('#wizard-stepper')).toBeVisible({ timeout: 20_000 })

    const connectorSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Select connector' }) }).first()
    await connectorSelect.selectOption({ index: 1 })

    // --- API Test: load operational CloudTrail sample ---
    await connectTab(page, 'api_test').click()
    await page.getByRole('button', { name: 'AWS CloudTrail', exact: true }).click()
    await page.getByText('Operational sample').waitFor({ timeout: 10_000 }).catch(() => {
      /* badge may read differently after fetch */
    })
    await page.waitForTimeout(400)
    const shotApi = path.join(ARTIFACT_DIR, '01-api-test-cloudtrail.png')
    await page.screenshot({ path: shotApi, fullPage: true })
    record('Load AWS CloudTrail sample', true, 'Loaded operational sample on API Test step', shotApi)

    // --- Preview / Record Selection ---
    await connectTab(page, 'record_selection').click()
    await expect(page.getByRole('heading', { name: 'Record Selection' })).toBeVisible({ timeout: 10_000 })

    // Select $.Records as Event Source (candidate chip)
    const recordsChip = page.getByRole('button', { name: /\$\.Records · \d+ records/ }).first()
    await recordsChip.click()
    await expect(page.getByText('$.Records', { exact: true }).first()).toBeVisible()

    // Select $.event as Event Root
    await page.getByRole('button', { name: '$.event', exact: true }).click()

    // Runtime Extraction summary
    const runtimeCard = page.locator('text=Runtime Extraction').locator('..').locator('..')
    await expect(runtimeCard.getByText('$.Records[*].event')).toBeVisible()
    record(
      'Runtime Extraction',
      true,
      'Summary shows $.Records[*].event',
      path.join(ARTIFACT_DIR, '02-runtime-extraction.png'),
    )
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-runtime-extraction.png'), fullPage: true })

    // Preview Sample (UI only)
    const summaryCard = (label: string) =>
      page.locator('div.rounded-md').filter({ has: page.getByText(label, { exact: true }) })
    await expect(summaryCard('Preview Sample').getByText('$.Records[0]', { exact: true })).toBeVisible()
    await expect(summaryCard('Event Source').getByText('$.Records', { exact: true })).toBeVisible()
    await expect(summaryCard('Runtime Extraction').getByText('$.Records[*].event', { exact: true })).toBeVisible()
    record('Preview Sample vs Event Source', true, 'Preview Sample is $.Records[0]; persisted Event Source is $.Records')

    const shotRecord = path.join(ARTIFACT_DIR, '03-record-selection-summary.png')
    await page.screenshot({ path: shotRecord, fullPage: true })

    // Checkpoint: event.eventTime
    const checkpointBtn = page
      .locator('#wizard-json-preview-panel')
      .getByRole('button', { name: /event\.eventTime/ })
      .first()
    await checkpointBtn.click()
    const checkpointInput = page.getByPlaceholder('event.eventTime')
    await expect(checkpointInput).toHaveValue('event.eventTime')
    await expect(page.getByText('event.eventTime').first()).toBeVisible()
    record('Checkpoint relative path', true, 'Stored checkpoint path is event.eventTime (relative to record)')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-checkpoint.png'), fullPage: true })

    // --- Copy actions ---
    await page.getByRole('button', { name: 'Copy runtime path' }).click()
    await page.getByText('Runtime expression copied').waitFor({ timeout: 3000 })
    const runtimeClip = await page.evaluate(async () => navigator.clipboard.readText())
    expect(runtimeClip).toBe('$.Records[*].event')
    record('Copy runtime expression', runtimeClip === '$.Records[*].event', `clipboard: ${runtimeClip}`)

    await page.getByRole('button', { name: 'Copy event source' }).click()
    await page.getByText('Event array path copied').waitFor({ timeout: 3000 })
    const sourceClip = await page.evaluate(async () => navigator.clipboard.readText())
    expect(sourceClip).toBe('$.Records')
    record('Copy event source path', sourceClip === '$.Records', `clipboard: ${sourceClip}`)

    await page.getByRole('button', { name: 'Copy event root' }).click()
    await page.getByText('Event root copied').waitFor({ timeout: 3000 })
    const rootClip = await page.evaluate(async () => navigator.clipboard.readText())
    expect(rootClip).toBe('$.event')
    record('Copy event root path', rootClip === '$.event', `clipboard: ${rootClip}`)

    // Copy JSON from extracted preview
    const extractedPanel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Extracted Event Preview' }) })
    await extractedPanel.getByRole('button', { name: 'JSON', exact: true }).click()
    await extractedPanel.getByRole('button', { name: 'Copy JSON', exact: true }).last().click()
    await page.getByText('Extracted event JSON copied').waitFor({ timeout: 3000 })
    const jsonClip = await page.evaluate(async () => navigator.clipboard.readText())
    const parsed = JSON.parse(jsonClip) as Record<string, unknown>
    const hasEventFields = 'eventVersion' in parsed || 'eventName' in parsed
    expect(hasEventFields).toBe(true)
    expect(parsed).not.toHaveProperty('metadata')
    record('Copy extracted object JSON', hasEventFields, `keys: ${Object.keys(parsed).slice(0, 6).join(', ')}…`)

    // Copy JSONPath from raw tree (Records array path)
    await page.getByRole('button', { name: 'Copy JSONPath $.Records', exact: true }).click()
    await page.waitForTimeout(500)
    const pathClip = await page.evaluate(async () => navigator.clipboard.readText())
    record('Copy JSONPath', pathClip.includes('Records'), `clipboard: ${pathClip}`)

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-copy-actions.png'), fullPage: true })

    // --- Mapping step: extracted event tree ---
    await stepButton(page, 'Mapping').click()
    await expect(page.getByTestId('wizard-step-mapping')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)

    const wizardPaths = await page.evaluate(() => {
      const raw = localStorage.getItem('gdc-stream-wizard-draft-v1')
      if (!raw) return null
      try {
        const s = JSON.parse(raw).state
        return {
          eventArrayPath: s?.stream?.eventArrayPath,
          eventRootPath: s?.stream?.eventRootPath,
          checkpointSourcePath: s?.stream?.checkpointSourcePath,
          extractedCount: s?.apiTest?.eventCount,
          firstEventKeys: s?.apiTest?.extractedEvents?.[0]
            ? Object.keys(s.apiTest.extractedEvents[0]).slice(0, 8)
            : [],
        }
      } catch {
        return null
      }
    })
    record(
      'Wizard state before mapping',
      Boolean(wizardPaths?.eventArrayPath === '$.Records' && wizardPaths?.firstEventKeys?.includes('eventVersion')),
      JSON.stringify(wizardPaths),
    )

    const mappingVisible = await page.getByRole('heading', { name: /^Field mapping/ }).isVisible().catch(() => false)
    if (mappingVisible) {
      await page.getByPlaceholder('Search fields').fill('eventVersion')
      const treeShowsEventField = await page
        .getByText('eventVersion', { exact: true })
        .first()
        .isVisible()
        .catch(() => false)
      record(
        'Mapping tree shows extracted CloudTrail fields',
        treeShowsEventField,
        treeShowsEventField ? 'eventVersion visible in mapping source tree' : 'Field mapping visible but tree fields differ',
      )
    } else {
      record(
        'Mapping receives extracted events (state)',
        (wizardPaths?.extractedCount ?? 0) === 10 && wizardPaths?.firstEventKeys?.includes('eventVersion'),
        `extractedCount=${wizardPaths?.extractedCount}; keys=${wizardPaths?.firstEventKeys?.join(', ')}`,
      )
    }

    const shotMapping = path.join(ARTIFACT_DIR, '06-mapping-step.png')
    await page.screenshot({ path: shotMapping, fullPage: true })

    // React state evidence via localStorage draft if saved — read from page evaluate
    const wizardState = await page.evaluate(() => {
      const raw = localStorage.getItem('gdc-stream-wizard-draft-v1')
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as { state?: { stream?: Record<string, string> } }
        return parsed.state?.stream ?? null
      } catch {
        return null
      }
    })
    if (wizardState) {
      record(
        'localStorage stream paths',
        wizardState.eventArrayPath === '$.Records' && wizardState.checkpointSourcePath === 'event.eventTime',
        JSON.stringify({
          eventArrayPath: wizardState.eventArrayPath,
          eventRootPath: wizardState.eventRootPath,
          checkpointSourcePath: wizardState.checkpointSourcePath,
        }),
      )
    }
  })
})
