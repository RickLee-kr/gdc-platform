/**
 * Browser verification: Normalize Rule field pickers + preview + Transform configured.
 * Also smoke-checks Timestamp Conversion pickers remain available.
 *
 *   cd frontend && PLAYWRIGHT_BASE_URL=https://127.0.0.1:18443 \
 *     npx playwright test --config=playwright.config.normalize-fields.ts
 */
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { expectAppShell } from './helpers/auth-flow'

const STREAM_NAME = `[NORMALIZE-VERIFY] ${Date.now()}`

type SessionPayload = {
  access_token: string
  refresh_token: string
  expires_at: string
  user: { username: string; role: string; status: string }
}

function issueSessionFromApiContainer(): SessionPayload {
  const script = `
from app.auth.jwt_service import issue_access_token, issue_refresh_token
from app.database import SessionLocal
from app.platform_admin.models import PlatformUser
from datetime import datetime, timezone, timedelta
import json
db = SessionLocal()
u = db.query(PlatformUser).filter(PlatformUser.username == 'admin').one()
access, _ = issue_access_token(username='admin', user_id=int(u.id), role='ADMINISTRATOR', token_version=int(u.token_version or 1))
refresh, _ = issue_refresh_token(username='admin', user_id=int(u.id), role='ADMINISTRATOR', token_version=int(u.token_version or 1))
expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
print(json.dumps({
  'access_token': access,
  'refresh_token': refresh,
  'expires_at': expires,
  'user': {'username': 'admin', 'role': 'ADMINISTRATOR', 'status': 'ACTIVE'},
}))
db.close()
`
  const out = execFileSync(
    'docker',
    ['compose', '-f', '/home/aella/gdc-platform/docker-compose.platform.yml', 'exec', '-T', 'api', 'python', '-c', script],
    { encoding: 'utf8' },
  )
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') && l.includes('access_token'))
  if (!line) throw new Error(`Failed to issue session token: ${out.slice(0, 500)}`)
  return JSON.parse(line) as SessionPayload
}

async function signIn(page: import('@playwright/test').Page) {
  const session = issueSessionFromApiContainer()
  await page.goto('/')
  await page.evaluate(
    ({ sessionPayload }) => {
      localStorage.setItem('gdc_platform_session_v1', JSON.stringify(sessionPayload))
      localStorage.setItem('gdc-platform-persona', 'connector')
    },
    { sessionPayload: session },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await expectAppShell(page)
  return session.access_token
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function saveNormalizeEnrichment(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  streamId: number,
) {
  const res = await request.post(`/api/v1/runtime/streams/${streamId}/mapping-ui/save`, {
    headers: authHeaders(token),
    ignoreHTTPSErrors: true,
    data: {
      enrichment: {
        enabled: true,
        enrichment: {
          __rules: {
            email: {
              type: 'normalize',
              label: 'Normalize',
              enabled: true,
              source_field: 'email',
              operation: 'normalize_email',
              on_failure: 'keep_original',
            },
          },
        },
      },
    },
  })
  expect(res.ok(), `mapping-ui/save ${res.status()} ${await res.text()}`).toBeTruthy()
}

async function readNormalizeRule(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  streamId: number,
) {
  const res = await request.get(`/api/v1/runtime/streams/${streamId}/mapping-ui/config`, {
    headers: authHeaders(token),
    ignoreHTTPSErrors: true,
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as {
    enrichment?: { enrichment?: { __rules?: Record<string, Record<string, unknown>> } }
  }
  const rule = body.enrichment?.enrichment?.__rules?.email
  expect(rule).toBeTruthy()
  return rule as Record<string, unknown>
}

async function goToRouteProcessing(page: import('@playwright/test').Page, streamId: number) {
  await page.goto(`/streams/${streamId}/edit?step=route_processing`)
  const routeProcessingStep = page.getByRole('button', { name: /Route Processing/i })
  if (await routeProcessingStep.isVisible()) await routeProcessingStep.click()
  await expect(page.getByTestId('wizard-step-route-processing')).toBeVisible({ timeout: 30_000 })
}

async function expandNormalizeCard(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('wizard-transform-enrichment-editor')).toBeVisible({ timeout: 30_000 })
  const fields = page.getByTestId('normalize-fields')
  if (!(await fields.isVisible())) {
    await page.getByLabel(/Expand rule/i).first().click()
  }
  await expect(page.getByTestId('normalize-source-field-trigger')).toBeVisible()
}

test('Normalize Source/Target pickers, preview, save/restore + Timestamp smoke', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const token = await signIn(page)

  const seedRes = await request.get('/api/v1/streams/47', {
    headers: authHeaders(token),
    ignoreHTTPSErrors: true,
  })
  expect(seedRes.ok(), `seed stream fetch ${seedRes.status()}`).toBeTruthy()
  const seed = (await seedRes.json()) as { connector_id: number; source_id: number }

  const createRes = await request.post('/api/v1/streams/', {
    headers: authHeaders(token),
    ignoreHTTPSErrors: true,
    data: {
      name: STREAM_NAME,
      connector_id: seed.connector_id,
      source_id: seed.source_id,
      stream_type: 'HTTP_API_POLLING',
      enabled: false,
      polling_interval: 3600,
      config_json: {
        method: 'GET',
        endpoint: '/normalize-verify',
        union_schema: {
          total_events: 2,
          fields: [
            {
              field_path: '$.email',
              field_type: 'string',
              occurrence_count: 2,
              sample_values: ['Test.User@Example.COM'],
            },
            {
              field_path: '$.event_time',
              field_type: 'integer',
              occurrence_count: 2,
              sample_values: [1679333933200],
            },
          ],
        },
      },
    },
  })
  expect(createRes.ok(), `create stream ${createRes.status()} ${await createRes.text()}`).toBeTruthy()
  const created = (await createRes.json()) as { id: number }
  const streamId = created.id

  try {
    await saveNormalizeEnrichment(request, token, streamId)
    const stored = await readNormalizeRule(request, token, streamId)
    expect(stored).toMatchObject({
      type: 'normalize',
      source_field: 'email',
      operation: 'normalize_email',
      on_failure: 'keep_original',
      enabled: true,
    })

    await expect
      .poll(async () => {
        const res = await request.get(`/api/v1/streams/${streamId}`, {
          headers: authHeaders(token),
          ignoreHTTPSErrors: true,
        })
        return res.status()
      })
      .toBe(200)

    await goToRouteProcessing(page, streamId)

    // Transform status should be Configured with enabled Normalize rule
    const transformCard = page.getByTestId('shared-processing-card-transform')
    await expect(transformCard).toBeVisible()
    await expect(transformCard).toContainText(/Configured/i)

    await expandNormalizeCard(page)
    await expect(page.getByTestId('normalize-card-summary')).toHaveText(/email\s*→\s*email/)
    await expect(page.getByTestId('normalize-source-field-trigger')).toContainText('email')
    await expect(page.getByTestId('normalize-target-field-trigger')).toContainText('email')
    // Only one Target Field label inside the rule body
    await expect(page.getByTestId('normalize-fields').getByText(/^Target Field$/i)).toHaveCount(1)
    await expect(page.getByTestId('normalize-preview-before')).toContainText('Test.User@Example.COM')
    await expect(page.getByTestId('normalize-preview-after')).toContainText('test.user@example.com')

    // Create a new target field
    await page.getByTestId('normalize-target-field-trigger').click()
    await page.getByTestId('normalize-target-field-search').fill('normalized_email')
    await page.getByTestId('normalize-target-field-create').click()
    await expect(page.getByTestId('normalize-target-field-trigger')).toContainText('normalized_email')
    await expect(page.getByTestId('normalize-card-summary')).toHaveText(/email\s*→\s*normalized_email/)

    // Persist via API with new target and re-open
    const saveRes = await request.post(`/api/v1/runtime/streams/${streamId}/mapping-ui/save`, {
      headers: authHeaders(token),
      ignoreHTTPSErrors: true,
      data: {
        enrichment: {
          enabled: true,
          enrichment: {
            __rules: {
              normalized_email: {
                type: 'normalize',
                label: 'Normalize',
                enabled: true,
                source_field: 'email',
                operation: 'normalize_email',
                on_failure: 'keep_original',
              },
            },
          },
        },
      },
    })
    expect(saveRes.ok()).toBeTruthy()

    await goToRouteProcessing(page, streamId)
    await expandNormalizeCard(page)
    await expect(page.getByTestId('normalize-source-field-trigger')).toContainText('email')
    await expect(page.getByTestId('normalize-target-field-trigger')).toContainText('normalized_email')
    await expect(page.getByTestId('normalize-preview-after')).toContainText('test.user@example.com')

    // Timestamp Conversion smoke via API hydrate (field pickers must remain comboboxes)
    const tsSave = await request.post(`/api/v1/runtime/streams/${streamId}/mapping-ui/save`, {
      headers: authHeaders(token),
      ignoreHTTPSErrors: true,
      data: {
        enrichment: {
          enabled: true,
          enrichment: {
            __rules: {
              normalized_email: {
                type: 'normalize',
                label: 'Normalize',
                enabled: true,
                source_field: 'email',
                operation: 'normalize_email',
                on_failure: 'keep_original',
              },
              '@timestamp': {
                type: 'timestamp_conversion',
                label: 'Timestamp Conversion',
                enabled: true,
                source_field: 'event_time',
                input_format: 'unix_ms',
                output_format: 'utc_iso8601',
                timezone: { mode: 'utc' },
                on_failure: 'keep_original',
              },
            },
          },
        },
      },
    })
    expect(tsSave.ok()).toBeTruthy()

    await goToRouteProcessing(page, streamId)
    await expect(page.getByTestId('wizard-transform-enrichment-editor')).toBeVisible({ timeout: 30_000 })
    const expandButtons = page.getByLabel(/Expand rule/i)
    const count = await expandButtons.count()
    // Expand the Timestamp Conversion card (second rule)
    if (count >= 2) await expandButtons.nth(1).click()
    else await expandButtons.first().click()
    await expect(page.getByTestId('timestamp-conversion-fields')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('ts-source-field-trigger')).toBeVisible()
    await expect(page.getByTestId('ts-target-field-trigger')).toBeVisible()
    await expect(page.getByTestId('timestamp-conversion-fields').getByText(/^Target Field$/i)).toHaveCount(1)
    await expect(page.getByTestId('ts-input-format')).toBeVisible()
    await expect(page.getByTestId('ts-output-format')).toBeVisible()
    await expect(page.getByTestId('ts-timezone-trigger')).toBeVisible()
    await expect(page.getByTestId('ts-on-failure')).toBeVisible()
    await expect(page.getByTestId('ts-preview-before')).toContainText('1679333933200')
  } finally {
    await request.delete(`/api/v1/streams/${streamId}`, {
      headers: authHeaders(token),
      ignoreHTTPSErrors: true,
    })
  }
})
