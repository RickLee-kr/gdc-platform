/**
 * Wizard full-event mapping — preview API + persisted field_mappings_json round-trip.
 *
 * Run (no auth global-setup):
 *   cd frontend && PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:8000 \
 *     npx playwright test --config=playwright.config.full-event-mapping.ts
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

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
