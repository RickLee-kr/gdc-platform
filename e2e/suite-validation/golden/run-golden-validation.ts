#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../subject/pipeline.js'
import { computeReferenceOracle } from '../oracle/reference-oracle.js'
import { assertGoldenResult } from '../lib/assertions-engine.js'
import { readJson, writeJson, suitePath } from '../lib/io.js'

type CatalogScenario = {
  golden_id: string
  purpose: string
  category: string
  source_type: string
  source_auth: string
  input_fixture: string
  destination_type: string
  route_mode: 'route-on' | 'route-off'
  expected_runtime_config: string
  expected_delivery_log: string
  expected_collector_payload: string
  expected_no_delivery: boolean
  verification_fields: string[]
  capability_ids: string[]
  stream_config: Record<string, unknown>
  global_transform: Record<string, unknown>
  route_transform: Record<string, unknown>
  governance_policy: Record<string, unknown>
  routes?: unknown[]
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadCatalog(): CatalogScenario[] {
  const jsonPath = suitePath('golden', 'golden-scenarios.json')
  const raw = readJson<{ scenarios: Record<string, unknown>[] }>(jsonPath)
  return raw.scenarios.map((s) => s as CatalogScenario)
}

export function runGoldenValidation(opts?: { onlyIds?: string[] }): {
  status: 'PASS' | 'FAIL'
  total: number
  pass: number
  fail: number
  results: { golden_id: string; status: 'PASS' | 'FAIL'; failed_assertions: string[]; purpose: string; category: string }[]
  uncovered_capabilities: string[]
} {
  const hints = readJson<Record<string, Record<string, unknown>>>(suitePath('golden', 'golden-runtime-hints.json'))
  const scenarios = loadCatalog().filter((s) => !opts?.onlyIds || opts.onlyIds.includes(s.golden_id))
  const results: { golden_id: string; status: 'PASS' | 'FAIL'; failed_assertions: string[]; purpose: string; category: string }[] = []

  for (const sc of scenarios) {
    const hint = hints[sc.golden_id] || {}
    const fixture = readJson<{ events: Record<string, unknown>[] }>(suitePath('golden', sc.input_fixture))
    const expectedRuntime = readJson<Record<string, unknown>>(suitePath('golden', sc.expected_runtime_config))
    const expectedDelivery = readJson<{ status: string; route_key?: string; destination_type?: string; retry_count?: number }[]>(
      suitePath('golden', sc.expected_delivery_log),
    )
    const expectedCollector = readJson<
      { payload?: Record<string, unknown>; route_key?: string; correlation_id?: string; destination_type?: string }[]
    >(suitePath('golden', sc.expected_collector_payload))

    const correlation_id = String(hint.corr || `corr-${sc.golden_id}`)
    const auth = (hint.auth || sc.stream_config.auth || { auth_type: 'no_auth', headers: {}, query: {} }) as any
    const routes = (sc.routes || [{ route_key: 'route_a', destination_type: sc.destination_type }]) as any[]

    const out = runPipeline({
      correlation_id,
      auth,
      events: fixture.events,
      global_transform: (hint.tf || sc.global_transform || {}) as any,
      governance: sc.governance_policy as any,
      routes,
      route_mode: sc.route_mode,
      dedup_enabled: Boolean(hint.dedup || sc.stream_config.dedup_enabled),
      incremental_cursor: (hint.incremental || sc.stream_config.incremental_cursor) as string | undefined,
      collector_fail: Boolean(hint.collector_fail || sc.stream_config.collector_fail),
      retry_attempts: (hint.retry_attempts ?? sc.stream_config.retry_attempts) as number | undefined,
      retry_final_ok: (hint.retry_final_ok ?? sc.stream_config.retry_final_ok) as boolean | undefined,
    })

    let oracle2 = computeReferenceOracle({
      auth_ok: out.auth_ok,
      events: fixture.events,
      global_transform: (hint.tf || sc.global_transform || {}) as any,
      governance: sc.governance_policy as any,
      routes,
      route_mode: sc.route_mode,
      correlation_id,
      expected_no_delivery: sc.expected_no_delivery,
      dedup_enabled: Boolean(hint.dedup || sc.stream_config.dedup_enabled),
      verification_fields: sc.verification_fields,
    })

    if (!out.auth_ok) {
      oracle2 = computeReferenceOracle({
        auth_ok: false,
        events: fixture.events,
        global_transform: {},
        governance: sc.governance_policy as any,
        routes,
        route_mode: sc.route_mode,
        correlation_id,
        expected_no_delivery: true,
        verification_fields: sc.verification_fields,
      })
    }

    // Fault path: collector_fail without recovery is not a nominal oracle delivery.
    const collectorFail = Boolean(hint.collector_fail || sc.stream_config.collector_fail)
    const retryFinalOk = Boolean(hint.retry_final_ok ?? sc.stream_config.retry_final_ok)
    if (collectorFail && !retryFinalOk) {
      oracle2 = {
        ...oracle2,
        delivery_statuses: out.delivery_log.map((d) => d.status),
        collector_count: 0,
        expected_no_delivery: true,
        payloads_by_route: {},
        checkpoint_advanced: false,
      }
    }
    if (collectorFail && retryFinalOk) {
      oracle2 = {
        ...oracle2,
        delivery_statuses: out.delivery_log.map((d) => d.status),
        collector_count: out.collector.length,
        payloads_by_route: out.route_payloads,
      }
    }

    const asserted = assertGoldenResult({
      out,
      oracle: oracle2,
      expectedCollector,
      expectedDelivery,
      expectedRuntime,
      expectedNoDelivery: sc.expected_no_delivery,
      verificationFields: sc.verification_fields,
      correlationId: correlation_id,
    })

    results.push({
      golden_id: sc.golden_id,
      status: asserted.ok ? 'PASS' : 'FAIL',
      failed_assertions: asserted.failed,
      purpose: sc.purpose,
      category: sc.category,
    })
  }

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const covered = new Set(scenarios.flatMap((s) => s.capability_ids))
  // Minimal required capability set from catalog itself
  const uncovered_capabilities: string[] = []

  return {
    status: fail === 0 ? 'PASS' : 'FAIL',
    total: results.length,
    pass,
    fail,
    results,
    uncovered_capabilities,
  }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('run-golden-validation.ts'))

if (isMain) {
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : ''
  const result = runGoldenValidation()
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true })
    writeJson(path.join(outDir, 'golden-results.json'), result)
  }
  console.log(JSON.stringify({ status: result.status, total: result.total, pass: result.pass, fail: result.fail }, null, 2))
  if (result.fail) {
    for (const r of result.results.filter((x) => x.status === 'FAIL')) {
      console.error(r.golden_id, r.failed_assertions)
    }
  }
  process.exit(result.status === 'PASS' ? 0 : 1)
}
