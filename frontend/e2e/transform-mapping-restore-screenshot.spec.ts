/**
 * Capture restored Transform mapping layout (206f0f7 WizardBasicMappingPanel).
 * Run: cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:18443 npx playwright test e2e/transform-mapping-restore-screenshot.spec.ts
 */
import path from 'node:path'
import { test } from '@playwright/test'
import { expectAppShell } from './helpers/auth-flow'
import { buildInitialState } from '../src/components/streams/wizard/wizard-state'

const VALIDATION_PASSWORD = process.env.PLAYWRIGHT_E2E_PASSWORD?.trim() || 'GdcSmokeE2e!2026'

async function signIn(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const passwords = [
    process.env.PLAYWRIGHT_E2E_PASSWORD?.trim(),
    process.env.PLAYWRIGHT_E2E_BOOTSTRAP_PASSWORD?.trim(),
    'admin',
    VALIDATION_PASSWORD,
  ].filter(Boolean) as string[]

  let session: {
    access_token: string
    refresh_token: string
    expires_at: string
    user: { username: string; role: string; status: string }
  } | null = null

  for (const password of passwords) {
    const loginRes = await request.post('/api/v1/auth/login', {
      data: { username: 'admin', password },
    })
    if (loginRes.ok()) {
      session = (await loginRes.json()) as typeof session
      break
    }
  }
  if (!session) throw new Error('Login failed for all known passwords')
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

test('capture restored Transform mapping layout screenshot', async ({ page, request }) => {
  const state = buildInitialState()
  const finishedAt = Date.now()
  state.connector.connectorId = 1
  state.connector.sourceId = 1
  state.connector.connectorName = 'Demo Connector'
  state.stream.name = 'Screenshot Stream'
  state.stream.endpoint = '/events'
  state.stream.eventArrayPath = '$.events'
  state.stream.checkpointSourcePath = '$.ts'
  state.stream.checkpointFieldType = 'datetime'
  state.stream.recordPathConfirmedForApiTestAt = finishedAt
  state.stream.checkpointConfirmedForApiTestAt = finishedAt
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.parsedJson = { events: [{ id: 'evt-1', message: 'hello world', severity: 'high' }] }
  state.apiTest.extractedEvents = [{ id: 'evt-1', message: 'hello world', severity: 'high' }]
  state.apiTest.finishedAt = finishedAt
  state.apiTest.eventCount = 1
  state.mapping = [{ id: 'm1', outputField: 'id', sourceJsonPath: '$.id', origin: 'manual' }]

  const draft = { version: 2, savedAt: Date.now(), stepKey: 'transform', state }

  await signIn(page, request)
  await page.evaluate((d) => {
    localStorage.setItem('gdc-stream-wizard-draft-v2', JSON.stringify(d))
  }, draft)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/streams/new')
  await page.getByTestId('wizard-draft-resume').click()
  await page.waitForSelector('[data-testid="wizard-step-transform"]')
  await page.getByText('Sample Event').waitFor()
  await page.getByText('Field Mapping').waitFor()
  await page.waitForTimeout(600)

  const out = path.join(__dirname, '../transform-mapping-restore-screenshot.png')
  await page.screenshot({ path: out, fullPage: false })
})
