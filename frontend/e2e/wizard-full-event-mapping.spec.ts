/**
 * Wizard full-event mapping — preview API + persisted field_mappings_json round-trip.
 *
 * Run (no auth global-setup):
 *   cd frontend && PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:8000 \
 *     npx playwright test --config=playwright.config.full-event-mapping.ts
 */
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  formatProbeSkipReason,
  probeAuthMode,
  signInForSmoke,
} from './helpers/auth-flow'

const SAMPLE_EVENT = {
  creationTime: 1673933930200,
  locked: false,
  roles: ['executive', 'user_admin', 'policies_admin', 'sys_admin'],
  username: 'adminuser@mec.ph',
  allowedLoginMethod: 'PASSWORD',
  totpEnabled: false,
}

const JSONATA_EXPRESSION = `{
  "timestamp": creationTime,
  "event_type": "user_account",
  "user": username,
  "domain": $split(username, "@")[1],
  "auth_method": allowedLoginMethod,
  "roles": roles,
  "role_count": $count(roles),
  "account_locked": locked,
  "mfa_enabled": totpEnabled
}`

const REGEX_WIZARD_CONFIG = {
  preserve_source: false,
  rules: [
    {
      output_field: 'user',
      source_path: '$.username',
      pattern: '^([^@]+)@(.+)$',
      group: 1,
      default: 'unknown_user',
    },
    {
      output_field: 'domain',
      source_path: '$.username',
      pattern: '^([^@]+)@(.+)$',
      group: 2,
      default: 'unknown_domain',
    },
    {
      output_field: 'auth_method',
      source_path: '$.allowedLoginMethod',
      pattern: '^(.*)$',
      group: 1,
      default: 'UNKNOWN',
    },
    {
      output_field: 'primary_admin_role',
      source_path: '$.roles',
      pattern: '(sys_admin|user_admin|policies_admin)',
      group: 1,
      default: 'standard_user',
    },
  ],
}

/** Mirrors buildWizardJsonataPreviewFieldMappings / wizard save payload. */
function wizardJsonataFieldMappings(expression: string): Record<string, unknown> {
  return {
    mapping_mode: 'full_event_jsonata',
    jsonata_expression: expression.trim(),
  }
}

/** Mirrors buildFieldMappingsFromFullEventRegexConfigJson stored shape. */
function wizardRegexFieldMappings(config: typeof REGEX_WIZARD_CONFIG): Record<string, unknown> {
  return {
    mapping_mode: 'full_event_regex',
    preserve_source_fields: config.preserve_source,
    regex_rules: config.rules.map((rule) => ({
      output_field: rule.output_field,
      source_path: rule.source_path,
      pattern: rule.pattern,
      capture_group: rule.group,
      default_value: rule.default,
    })),
  }
}

async function apiHealthOk(request: APIRequestContext): Promise<boolean> {
  const apiBase = (process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
  try {
    const res = await request.get(`${apiBase}/health`, { timeout: 8_000 })
    return res.ok()
  } catch {
    return false
  }
}

async function resolveE2eStreamId(request: APIRequestContext): Promise<number | null> {
  const fromEnv = Number(process.env.PLAYWRIGHT_E2E_STREAM_ID ?? '')
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv

  const topo = await request.get('/api/v1/runtime/topology', { timeout: 15_000 })
  if (!topo.ok()) return null
  const body = (await topo.json()) as { streams?: Array<{ stream_id: number; stream_name?: string }> }
  const streams = body.streams ?? []
  const dev = streams.find((s) => (s.stream_name ?? '').includes('[DEV VALIDATION]'))
  return dev?.stream_id ?? streams[0]?.stream_id ?? null
}

type MappingSnapshot = {
  event_array_path: string | null
  event_root_path: string | null
  field_mappings: Record<string, unknown>
}

async function readMappingSnapshot(request: APIRequestContext, streamId: number): Promise<MappingSnapshot> {
  const res = await request.get(`/api/v1/runtime/streams/${streamId}/mapping-ui/config`, { timeout: 15_000 })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as {
    mapping?: {
      event_array_path?: string | null
      event_root_path?: string | null
      field_mappings?: Record<string, unknown>
    }
  }
  return {
    event_array_path: body.mapping?.event_array_path ?? null,
    event_root_path: body.mapping?.event_root_path ?? null,
    field_mappings: { ...(body.mapping?.field_mappings ?? {}) },
  }
}

async function saveMappingPayload(
  request: APIRequestContext,
  streamId: number,
  fieldMappings: Record<string, unknown>,
  snapshot: MappingSnapshot,
): Promise<void> {
  const res = await request.post(`/api/v1/runtime/streams/${streamId}/mapping-ui/save`, {
    data: {
      mapping: {
        event_array_path: snapshot.event_array_path,
        event_root_path: snapshot.event_root_path,
        field_mappings: fieldMappings,
      },
    },
    timeout: 20_000,
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { mapping_saved?: boolean }
  expect(body.mapping_saved).toBe(true)
}

test.describe('Wizard full-event mapping', () => {
  test.beforeAll(async ({ request }) => {
    const ok = await apiHealthOk(request)
    test.skip(!ok, 'API /health unreachable — start backend (PLAYWRIGHT_API_BASE_URL)')
  })

  test('JSONata Preview — POST /runtime/preview/transform', async ({ request }) => {
    const fieldMappings = wizardJsonataFieldMappings(JSONATA_EXPRESSION)
    const res = await request.post('/api/v1/runtime/preview/transform', {
      data: {
        stage: 'mapping',
        sample_event: SAMPLE_EVENT,
        field_mappings: fieldMappings,
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.errors).toEqual([])
    expect(body.save_blocked).toBe(false)
    expect(body.transformed_result.domain).toBe('mec.ph')
    expect(body.transformed_result.role_count).toBe(4)
    expect(body.transformed_result.event_type).toBe('user_account')
  })

  test('Regex Preview — POST /runtime/preview/transform', async ({ request }) => {
    const fieldMappings = wizardRegexFieldMappings(REGEX_WIZARD_CONFIG)
    const res = await request.post('/api/v1/runtime/preview/transform', {
      data: {
        stage: 'mapping',
        sample_event: SAMPLE_EVENT,
        field_mappings: fieldMappings,
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.errors).toEqual([])
    expect(body.save_blocked).toBe(false)
    expect(body.transformed_result).toEqual({
      user: 'adminuser',
      domain: 'mec.ph',
      auth_method: 'PASSWORD',
      primary_admin_role: 'user_admin',
    })
  })

  test('JSONata UI Preview — wizard Advanced tab shows transformed output', async ({ page, request }) => {
    test.skip(!(await apiHealthOk(request)), 'API /health unreachable — start backend (PLAYWRIGHT_API_BASE_URL)')

    const probe = await probeAuthMode(request)
    if (probe.mode !== 'ready' && !(probe.mode === 'must_change_password' && probe.steadyPassword)) {
      test.skip(true, formatProbeSkipReason(probe))
      return
    }
    await signInForSmoke(page, probe)

    const sampleBody = JSON.stringify(SAMPLE_EVENT)
    await page.route('**/api/v1/runtime/api-test/http', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          request: { method: 'GET', url: 'http://127.0.0.1/e2e/full-event-sample', headers_masked: {} },
          response: {
            status_code: 200,
            latency_ms: 3,
            headers: { 'content-type': 'application/json' },
            raw_body: sampleBody,
            parsed_json: SAMPLE_EVENT,
            content_type: 'application/json',
          },
          analysis: {
            response_summary: {
              root_type: 'object',
              approx_size_bytes: sampleBody.length,
              top_level_keys: Object.keys(SAMPLE_EVENT),
              item_count_root: null,
              truncation: null,
            },
            detected_arrays: [],
            detected_checkpoint_candidates: [],
            sample_event: SAMPLE_EVENT,
            selected_event_array_default: null,
            flat_preview_fields: ['$.username', '$.roles', '$.creationTime'],
            preview_error: null,
          },
        }),
      })
    })

    await page.goto('/streams/new')
    await expect(page.locator('#wizard-stepper')).toBeVisible({ timeout: 20_000 })

    const savedConnector = page.getByTestId('wizard-saved-connector-select')
    await expect(savedConnector).toBeVisible({ timeout: 20_000 })
    const devOption = savedConnector.locator('option', { hasText: '[DEV VALIDATION]' }).first()
    if ((await devOption.count()) > 0) {
      const value = await devOption.getAttribute('value')
      if (value) await savedConnector.selectOption(value)
      else await savedConnector.selectOption({ index: 1 })
    } else {
      await savedConnector.selectOption({ index: 1 })
    }

    const stepButton = (title: string) => page.locator('#wizard-stepper button').filter({ hasText: title })

    await stepButton('Sample').click()
    const apiTestBtn = page.getByRole('button', { name: 'API Test' })
    await expect(apiTestBtn).toBeEnabled({ timeout: 15_000 })
    const apiWait = page.waitForResponse(
      (res) => res.url().includes('/runtime/api-test/http') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await apiTestBtn.click()
    expect((await apiWait).ok()).toBeTruthy()

    await stepButton('Transform').click()
    await page.getByTestId('wizard-transform-section-output_fields').click()
    await expect(page.getByRole('tab', { name: /Advanced · JSONata/i })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /Advanced · JSONata/i }).click()

    const jsonataArea = page.getByRole('textbox', { name: 'Full event JSONata expression' })
    await expect(jsonataArea).toBeVisible({ timeout: 15_000 })
    await jsonataArea.fill(JSONATA_EXPRESSION)

    const previewResponse = page.waitForResponse(
      (res) => res.url().includes('/runtime/preview/transform') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: /^Preview$/i }).click()
    const previewRes = await previewResponse
    expect(previewRes.ok()).toBeTruthy()
    const previewBody = (await previewRes.json()) as {
      errors: unknown[]
      transformed_result: Record<string, unknown>
    }
    expect(previewBody.errors).toEqual([])
    expect(previewBody.transformed_result.event_type).toBe('user_account')
    expect(previewBody.transformed_result.domain).toBe('mec.ph')
    expect(previewBody.transformed_result.role_count).toBe(4)

    const outputPanel = page.getByText('Final mapped event').locator('..').locator('pre')
    await expect(outputPanel).toContainText('"event_type": "user_account"', { timeout: 15_000 })
    await expect(outputPanel).toContainText('"domain": "mec.ph"')
    await expect(outputPanel).toContainText('"role_count": 4')
    await expect(outputPanel).not.toContainText('"username": "adminuser@mec.ph"')
  })

  test('Save payload — mapping-ui/save round-trip for wizard field_mappings_json', async ({ request }) => {
    const streamId = await resolveE2eStreamId(request)
    test.skip(streamId == null, 'No stream available for save round-trip (set PLAYWRIGHT_E2E_STREAM_ID)')

    const before = await readMappingSnapshot(request, streamId!)

    const jsonataPayload = wizardJsonataFieldMappings(JSONATA_EXPRESSION)
    const regexPayload = wizardRegexFieldMappings(REGEX_WIZARD_CONFIG)

    try {
      await saveMappingPayload(request, streamId!, jsonataPayload, before)
      let after = await readMappingSnapshot(request, streamId!)
      expect(after.field_mappings.mapping_mode).toBe('full_event_jsonata')
      expect(after.field_mappings.jsonata_expression).toBe(JSONATA_EXPRESSION.trim())

      await saveMappingPayload(request, streamId!, regexPayload, before)
      after = await readMappingSnapshot(request, streamId!)
      expect(after.field_mappings.mapping_mode).toBe('full_event_regex')
      expect(after.field_mappings.preserve_source_fields).toBe(false)
      expect(Array.isArray(after.field_mappings.regex_rules)).toBe(true)
      const rules = after.field_mappings.regex_rules as Array<Record<string, unknown>>
      expect(rules).toHaveLength(4)
      expect(rules[0]?.output_field).toBe('user')
      expect(rules[0]?.source_path).toBe('$.username')
      expect(rules[0]?.capture_group).toBe(1)

      const preview = await request.post('/api/v1/runtime/preview/transform', {
        data: { stage: 'mapping', sample_event: SAMPLE_EVENT, field_mappings: after.field_mappings },
      })
      expect(preview.ok()).toBeTruthy()
      const previewBody = await preview.json()
      expect(previewBody.transformed_result.primary_admin_role).toBe('user_admin')
    } finally {
      await saveMappingPayload(request, streamId!, before.field_mappings, before)
      const restored = await readMappingSnapshot(request, streamId!)
      expect(restored.field_mappings).toEqual(before.field_mappings)
    }
  })
})
