/** Load and filter generated Full Matrix scenarios. */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { E2EScenario, MatrixBundle } from '../scenarios/scenario-types.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadFullMatrix(): MatrixBundle {
  const file = path.join(root, 'scenarios', 'generated', 'full-matrix.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as MatrixBundle
}

export function filterScenarios(opts?: {
  suite?: string
  shard?: string
  executionMode?: string
  routeProcessing?: string
  ids?: string[]
  tags?: string[]
  limit?: number
}): E2EScenario[] {
  const bundle = loadFullMatrix()
  let list = bundle.scenarios
  const shardEnv = process.env.GDC_E2E_SHARD
  const suiteEnv = process.env.GDC_E2E_SUITE
  const modeEnv = process.env.GDC_E2E_EXECUTION_MODE
  const routeEnv = process.env.GDC_ROUTE_PROCESSING_ENABLED
  const limitEnv = process.env.GDC_E2E_MATRIX_LIMIT
  const idsEnv = process.env.GDC_E2E_SCENARIO_IDS

  const shard = opts?.shard || shardEnv
  const suite = opts?.suite || suiteEnv
  const mode = opts?.executionMode || modeEnv
  const route =
    opts?.routeProcessing ||
    (routeEnv === 'true' || routeEnv === '1' || routeEnv === 'on' ? 'on' : routeEnv === 'false' || routeEnv === '0' || routeEnv === 'off' ? 'off' : undefined)
  const ids =
    opts?.ids ||
    (idsEnv
      ? idsEnv
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined)

  if (suite) list = list.filter((s) => s.suite === suite)
  if (shard) list = list.filter((s) => s.shard === shard || s.tags.includes(`shard:${shard}`))
  if (mode) list = list.filter((s) => s.executionMode === mode)
  if (route) list = list.filter((s) => s.routeProcessing === route || s.routeProcessing === 'both')
  if (ids?.length) list = list.filter((s) => ids.includes(s.id))
  if (opts?.tags?.length) list = list.filter((s) => opts.tags!.every((t) => s.tags.includes(t)))

  const limit = opts?.limit ?? (limitEnv ? Number(limitEnv) : undefined)
  if (limit && limit > 0) list = list.slice(0, limit)
  return list
}

export function enrichmentRuleForTransform(transformId: string | undefined): unknown[] {
  switch (transformId) {
    case 'processing.enrichment.static':
      return [{ type: 'static', target_field: 'e2e_static', value: 'full-e2e-static' }]
    case 'processing.enrichment.calculated':
      return [{ type: 'calculated', target_field: 'e2e_calc', expression: '1+1' }]
    case 'processing.enrichment.conditional':
      return [
        {
          type: 'conditional',
          target_field: 'e2e_cond',
          when: [{ field: 'severity', equals: 'MEDIUM' }],
          then: 'matched',
          default: 'other',
        },
      ]
    case 'processing.enrichment.normalize':
      return [{ type: 'normalize', source_field: 'severity', target_field: 'severity_norm', template: 'upper' }]
    case 'processing.enrichment.timestamp_conversion':
      return [
        {
          type: 'timestamp_conversion',
          source_field: 'timestamp',
          target_field: 'ts_utc',
          output_format: 'iso8601',
        },
      ]
    case 'processing.enrichment.type_conversion':
      return [{ type: 'type_conversion', source_field: 'id', target_field: 'id_str', target_type: 'string' }]
    case 'processing.enrichment.jsonata':
      return [{ type: 'jsonata', target_field: 'e2e_j', expression: 'message' }]
    case 'processing.mapping.field_jsonpath':
      return []
    case 'processing.mapping.full_event_jsonata':
      return []
    case 'processing.mapping.full_event_regex':
      return []
    case 'processing.mapping.unmapped_policy':
      return []
    default:
      return [{ type: 'static', target_field: 'e2e_static', value: 'default' }]
  }
}

export function correlationForScenario(scenario: E2EScenario): string | string[] {
  const auth = scenario.source?.authentication || 'no_auth'
  const sourceType = scenario.source?.type
  // Accept any seeded object/file correlation — listing order is not guaranteed.
  if (sourceType === 'S3_OBJECT_POLLING') {
    return [
      'full-e2e-corr-s3-init-1',
      'full-e2e-corr-s3-new-1',
      'full-e2e-corr-s3-dup-1',
      'full-e2e-corr-s3-nested-1',
    ]
  }
  if (sourceType === 'REMOTE_FILE_POLLING') {
    return [
      'full-e2e-corr-sftp-init-1',
      'full-e2e-corr-sftp-new-1',
      'full-e2e-corr-sftp-append-1',
      'full-e2e-corr-sftp-ko-1',
    ]
  }
  if (sourceType === 'DATABASE_QUERY') return 'full-e2e-corr-db-1'
  // Webhook push uses a per-scenario stable id (executor overrides with unique suffix).
  if (sourceType === 'WEBHOOK_RECEIVER') return `full-e2e-corr-webhook-${scenario.id}`
  if (auth === 'basic') return 'full-e2e-corr-basic-1'
  if (auth === 'bearer') return 'full-e2e-corr-bearer-1'
  if (auth === 'api_key' || auth === 'api_key_header') return 'full-e2e-corr-apikey-1'
  return 'full-e2e-corr-noauth-1'
}

/** Unique correlation for a single webhook push (avoids cross-scenario collector collisions). */
export function uniqueWebhookCorrelation(scenario: E2EScenario, suffix: string): string {
  const stem = scenario.id.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48)
  return `full-e2e-corr-wh-${stem}-${suffix}`
}
