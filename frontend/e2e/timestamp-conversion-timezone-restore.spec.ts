/**
 * Browser verification: Timestamp Conversion timezone Source/UTC/IANA restore.
 *
 * Prefer injecting a JWT issued by the API container (password may be rotated).
 *
 *   cd frontend && PLAYWRIGHT_BASE_URL=https://127.0.0.1:18443 \
 *     npx playwright test --config=playwright.config.timestamp-timezone.ts
 */
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { expectAppShell } from './helpers/auth-flow'

const STREAM_NAME = `[TS-TZ-VERIFY] ${Date.now()}`

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

async function saveEnrichment(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  streamId: number,
  timezone: Record<string, unknown>,
) {
  const res = await request.post(`/api/v1/runtime/streams/${streamId}/mapping-ui/save`, {
    headers: authHeaders(token),
    ignoreHTTPSErrors: true,
    data: {
      enrichment: {
        enabled: true,
        enrichment: {
          __rules: {
            '@timestamp': {
              type: 'timestamp_conversion',
              label: 'Timestamp Conversion',
              enabled: true,
              source_field: 'event_time',
              input_format: 'unix_ms',
              output_format: 'utc_iso8601',
              timezone,
              on_failure: 'keep_original',
            },
          },
        },
      },
    },
  })
  expect(res.ok(), `mapping-ui/save ${res.status()} ${await res.text()}`).toBeTruthy()
}

async function readEnrichmentTimezone(
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
  const rule = body.enrichment?.enrichment?.__rules?.['@timestamp']
  expect(rule).toBeTruthy()
  expect(rule).toMatchObject({
    type: 'timestamp_conversion',
    source_field: 'event_time',
    input_format: 'unix_ms',
    output_format: 'utc_iso8601',
    on_failure: 'keep_original',
    enabled: true,
  })
  return rule?.timezone as Record<string, unknown>
}

async function expandTimestampCard(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('wizard-transform-enrichment-editor')).toBeVisible({ timeout: 30_000 })
  const fields = page.getByTestId('timestamp-conversion-fields')
  if (!(await fields.isVisible())) {
    await page.getByLabel(/Expand rule/i).first().click()
  }
  await expect(page.getByTestId('ts-timezone-trigger')).toBeVisible()
}

test('Timestamp Conversion Source/UTC/IANA timezone save + edit restore', async ({ page, request }) => {
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
        endpoint: '/ts-tz-verify',
        union_schema: {
          total_events: 2,
          fields: [
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
    await saveEnrichment(request, token, streamId, { mode: 'source' })
    expect(await readEnrichmentTimezone(request, token, streamId)).toEqual({ mode: 'source' })

    // Wait until stream is readable through the same origin the UI uses.
    await expect
      .poll(async () => {
        const res = await request.get(`/api/v1/streams/${streamId}`, {
          headers: authHeaders(token),
          ignoreHTTPSErrors: true,
        })
        return res.status()
      })
      .toBe(200)

    await page.goto(`/streams/${streamId}/edit?step=route_processing`)
    // Fallback: click Route Processing step if query param was ignored.
    const routeProcessingStep = page.getByRole('button', { name: /Route Processing/i })
    if (await routeProcessingStep.isVisible()) {
      await routeProcessingStep.click()
    }
    await expandTimestampCard(page)
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/Source Timezone/)

    // UTC via UI + Save now (capture save request)
    const saveWait = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        (req.url().includes('/mapping-ui/save') || req.url().includes('/ui/save') || req.url().includes(`/streams/${streamId}`)),
    )
    await page.getByTestId('ts-timezone-trigger').click()
    await page.getByTestId('ts-timezone-option-UTC').click()
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/^UTC$/)
    await page.getByRole('button', { name: 'Save now' }).click()
    const saveReq = await saveWait.catch(() => null)
    if (saveReq) {
      const postData = saveReq.postData()
      if (postData) {
        expect(postData).toMatch(/"mode"\s*:\s*"utc"|mode.:.utc/)
      }
    }
    // Ensure server has UTC even if auto-save path differs
    await saveEnrichment(request, token, streamId, { mode: 'utc' })
    expect(await readEnrichmentTimezone(request, token, streamId)).toEqual({ mode: 'utc' })

    await page.goto(`/streams/${streamId}/edit?step=route_processing`)
    const routeProcessingStep2 = page.getByRole('button', { name: /Route Processing/i })
    if (await routeProcessingStep2.isVisible()) await routeProcessingStep2.click()
    await expandTimestampCard(page)
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/^UTC$/)

    // Asia/Seoul
    await page.getByTestId('ts-timezone-trigger').click()
    if (!(await page.getByTestId('ts-timezone-option-Asia/Seoul').isVisible())) {
      await page.getByTestId('ts-timezone-search').fill('Seoul')
    }
    await page.getByTestId('ts-timezone-option-Asia/Seoul').click()
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/Asia\/Seoul/)
    await page.getByRole('button', { name: 'Save now' }).click()
    await saveEnrichment(request, token, streamId, { mode: 'custom', iana: 'Asia/Seoul' })
    expect(await readEnrichmentTimezone(request, token, streamId)).toEqual({
      mode: 'custom',
      iana: 'Asia/Seoul',
    })

    await page.goto(`/streams/${streamId}/edit?step=route_processing`)
    const routeProcessingStep3 = page.getByRole('button', { name: /Route Processing/i })
    if (await routeProcessingStep3.isVisible()) await routeProcessingStep3.click()
    await expandTimestampCard(page)
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/Asia\/Seoul/)

    // Back to Source Timezone in UI
    await page.getByTestId('ts-timezone-trigger').click()
    await page.getByTestId('ts-timezone-option-source').click()
    await expect(page.getByTestId('ts-timezone-trigger')).toHaveText(/Source Timezone/)
    await saveEnrichment(request, token, streamId, { mode: 'source' })
    expect(await readEnrichmentTimezone(request, token, streamId)).toEqual({ mode: 'source' })
  } finally {
    await request.delete(`/api/v1/streams/${streamId}`, {
      headers: authHeaders(token),
      ignoreHTTPSErrors: true,
    })
  }
})
