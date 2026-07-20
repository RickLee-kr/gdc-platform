#!/usr/bin/env npx tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../subject/pipeline.js'
import { computeReferenceOracle } from '../oracle/reference-oracle.js'
import { assertGoldenResult } from '../lib/assertions-engine.js'
import { readJson, writeJson, suitePath } from '../lib/io.js'
import { AUTH_EXPECTED } from '../subject/auth.js'

type Control = {
  control_id: string
  description: string
  defect_kind: string
  target_golden_id: string
  inject: Record<string, unknown>
  expected_failing_assertions: string[]
  must_not_fail_unrelated: boolean
}

function applyInject(opts: {
  auth: any
  governance: any
  global_transform: any
  routes: any[]
  dedup_enabled: boolean
  correlation_id: string
  inject: Record<string, unknown>
  expectedCollector: any[]
}): {
  auth: any
  governance: any
  global_transform: any
  routes: any[]
  dedup_enabled: boolean
  correlation_id: string
  expectedCollector: any[]
  post?: (out: any) => any
} {
  const inject = opts.inject
  let auth = structuredClone(opts.auth)
  let governance = structuredClone(opts.governance)
  let global_transform = structuredClone(opts.global_transform)
  let routes = structuredClone(opts.routes)
  let dedup_enabled = opts.dedup_enabled
  let correlation_id = opts.correlation_id
  let expectedCollector = structuredClone(opts.expectedCollector)

  if (inject.auth_token) auth.headers = { ...auth.headers, authorization: `Bearer ${inject.auth_token}` }
  if (inject.basic_pass) {
    const token = Buffer.from(`${AUTH_EXPECTED.basic_user}:${inject.basic_pass}`).toString('base64')
    auth.headers = { ...auth.headers, authorization: `Basic ${token}` }
  }
  if (inject.api_key) auth.headers = { ...auth.headers, 'X-API-Key': String(inject.api_key) }
  if (inject.force_governance_allow) {
    governance = { ...governance, schema_drift: 'allow', unknown_field: 'pass_through', protection: 'none' }
  }
  if (inject.force_unknown_passthrough) governance = { ...governance, unknown_field: 'pass_through' }
  if (inject.force_no_protection) governance = { ...governance, protection: 'none', confidential_detection: false }
  if (inject.force_all_routes_use_a && routes.length > 1) {
    routes = routes.map((r) => ({ ...r, transform_override: routes[0].transform_override, destination_type: routes[0].destination_type }))
  }
  if (inject.strip_jsonata) global_transform = { ...global_transform, jsonata: null }
  if (inject.strip_regex) global_transform = { ...global_transform, regex: null }
  if (inject.strip_timestamp) global_transform = { ...global_transform, timestamp: null }
  if (inject.force_dedup_off) dedup_enabled = false
  if (inject.corrupt_expected_host_mapped) {
    expectedCollector = expectedCollector.map((c) => ({
      ...c,
      payload: { ...(c.payload || {}), host_mapped: inject.corrupt_expected_host_mapped },
    }))
  }

  const post = (out: any) => {
    let next = structuredClone(out)
    if (inject.force_collector_empty) next.collector = []
    if (inject.force_delivery_success) {
      next.delivery_log = next.delivery_log.length
        ? next.delivery_log.map((d: any) => ({ ...d, status: 'SUCCESS' }))
        : [{ correlation_id, route_key: 'route_a', destination_type: 'WEBHOOK_POST', status: 'SUCCESS', payload: {}, retry_count: 0 }]
    }
    if (inject.force_wrong_correlation || inject.force_foreign_collector) {
      next.collector = next.collector.map((c: any) => ({ ...c, correlation_id: 'foreign-corr-id' }))
      next.correlation_errors = [`correlation_mismatch:foreign-corr-id`]
    }
    if (inject.force_delivery_empty_keep_collector) {
      next.delivery_log = []
      next.contract_errors = [...(next.contract_errors || []), 'collector_payload_without_delivery_log']
    }
    if (inject.force_collector_empty && inject.force_delivery_success) {
      next.contract_errors = [...new Set([...(next.contract_errors || []), 'collector_zero_with_delivery_success', 'false_pass_collector_zero'])]
    }
    return next
  }

  return { auth, governance, global_transform, routes, dedup_enabled, correlation_id, expectedCollector, post }
}

export function runNegativeControls(): {
  status: 'PASS' | 'FAIL' | 'FALSE_PASS_DETECTED'
  total: number
  detected: number
  false_pass: number
  results: any[]
} {
  const catalog = readJson<{ scenarios: any[] }>(suitePath('golden', 'golden-scenarios.json'))
  const hints = readJson<Record<string, any>>(suitePath('golden', 'golden-runtime-hints.json'))
  const controls = readJson<{ controls: Control[] }>(suitePath('negative', 'negative-controls.json')).controls
  const byId = new Map(catalog.scenarios.map((s) => [s.golden_id, s]))
  const results: any[] = []

  for (const ctrl of controls) {
    const sc = byId.get(ctrl.target_golden_id)
    if (!sc) {
      results.push({ control_id: ctrl.control_id, status: 'ERROR', reason: 'missing_target' })
      continue
    }
    const hint = hints[sc.golden_id] || {}
    const fixture = readJson<{ events: Record<string, unknown>[] }>(suitePath('golden', sc.input_fixture))
    const expectedRuntime = readJson<Record<string, unknown>>(suitePath('golden', sc.expected_runtime_config))
    const expectedDelivery = readJson<any[]>(suitePath('golden', sc.expected_delivery_log))
    const expectedCollectorBase = readJson<any[]>(suitePath('golden', sc.expected_collector_payload))
    const correlation_id = String(hint.corr || `corr-${sc.golden_id}`)
    const injected = applyInject({
      auth: hint.auth || sc.stream_config.auth,
      governance: sc.governance_policy,
      global_transform: hint.tf || sc.global_transform || {},
      routes: sc.routes || [{ route_key: 'route_a', destination_type: sc.destination_type }],
      dedup_enabled: Boolean(hint.dedup || sc.stream_config.dedup_enabled),
      correlation_id,
      inject: ctrl.inject,
      expectedCollector: expectedCollectorBase,
    })

    let out = runPipeline({
      correlation_id: injected.correlation_id,
      auth: injected.auth,
      events: fixture.events,
      global_transform: injected.global_transform,
      governance: injected.governance,
      routes: injected.routes,
      route_mode: sc.route_mode,
      dedup_enabled: injected.dedup_enabled,
      incremental_cursor: hint.incremental,
      collector_fail: hint.collector_fail,
      retry_attempts: hint.retry_attempts,
      retry_final_ok: hint.retry_final_ok,
    })
    if (injected.post) out = injected.post(out)

    const oracle = computeReferenceOracle({
      auth_ok: true,
      events: fixture.events,
      global_transform: hint.tf || sc.global_transform || {},
      governance: sc.governance_policy,
      routes: sc.routes || [{ route_key: 'route_a', destination_type: sc.destination_type }],
      route_mode: sc.route_mode,
      correlation_id,
      expected_no_delivery: sc.expected_no_delivery,
      dedup_enabled: Boolean(hint.dedup || sc.stream_config.dedup_enabled),
      verification_fields: sc.verification_fields,
    })

    const asserted = assertGoldenResult({
      out,
      oracle,
      expectedCollector: injected.expectedCollector,
      expectedDelivery,
      expectedRuntime,
      expectedNoDelivery: sc.expected_no_delivery,
      verificationFields: sc.verification_fields,
      correlationId: correlation_id,
    })

    const matched = ctrl.expected_failing_assertions.some((a) =>
      asserted.failed.some((f) => f.includes(a)),
    )
    const detected = !asserted.ok && matched
    const false_pass = asserted.ok
    results.push({
      control_id: ctrl.control_id,
      description: ctrl.description,
      target_golden_id: ctrl.target_golden_id,
      detected,
      false_pass,
      failed_assertions: asserted.failed,
      status: false_pass ? 'FALSE_PASS' : detected ? 'DETECTED' : 'MISS',
    })
  }

  const false_pass = results.filter((r) => r.false_pass).length
  const detected = results.filter((r) => r.detected).length
  const status = false_pass ? 'FALSE_PASS_DETECTED' : detected === results.length ? 'PASS' : 'FAIL'
  return { status, total: results.length, detected, false_pass, results }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('run-negative-controls.ts'))

if (isMain) {
  const r = runNegativeControls()
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : ''
  if (out) writeJson(path.join(out, 'negative-control-results.json'), r)
  console.log(JSON.stringify({ status: r.status, total: r.total, detected: r.detected, false_pass: r.false_pass }, null, 2))
  process.exit(r.status === 'PASS' ? 0 : 1)
}
