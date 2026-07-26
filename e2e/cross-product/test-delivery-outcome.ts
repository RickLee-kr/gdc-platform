#!/usr/bin/env npx tsx
/**
 * Regression + negative tests for Runtime-evidence delivery_outcome derivation.
 *
 * Covers:
 * - HTTP/S3/REMOTE_FILE → SYSLOG_TLS expected delivered requires send+collector
 * - TLS handshake failure → failed (no delivered from oracle alone)
 * - Primary fail + Failover success
 * - Both fail
 * - Runtime telemetry 0 → runtime_not_executed (never delivered)
 */
import assert from 'node:assert/strict'
import {
  assertDeliveryOutcomeConsistency,
  countDeliveryStages,
  deriveActualDeliveryOutcome,
  detectSilentRuntimeNoop,
  runtimeWasExecuted,
} from './delivery-outcome.js'
import { computeOracle } from './oracle.js'
import { evaluateRouteCollectorOutcome, buildRouteCollectorPlan } from './collector-route-plan.js'
import type { CrossProductAxes } from './cross-product-types.js'

function baseAxes(over: Partial<CrossProductAxes> = {}): CrossProductAxes {
  return {
    execution_surface: 'API_SEEDED',
    route_runtime: 'ROUTE_ON',
    source_type: 'REMOTE_FILE_POLLING',
    source_auth: 'ssh',
    destination_type: 'SYSLOG_TLS',
    destination_auth_protocol: 'NONE',
    route_topology: 'SINGLE_ROUTE',
    field_mapping: 'ON',
    timestamp_normalization: 'ON',
    jsonata: 'ON',
    regex: 'ON',
    protection_action: 'audit',
    delivery_behavior: 'continue',
    incremental_fetch: 'OFF',
    dedup_strategy: 'EVENT_ID_SKIP_DUPLICATE',
    unknown_field_type: 'NORMAL',
    unknown_field_policy: 'QUARANTINE',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
    fault_type: 'NONE',
    replay_mode: 'NONE',
    failover_mode: 'NONE',
    source_configuration_profile: 'DEFAULT',
    collection_mode: 'POLLING',
    payload_format: 'JSON',
    record_path_event_root_profile: 'ROOT_ARRAY',
    union_schema_profile: 'BASELINE_WITH_RARE',
    checkpoint_strategy: 'NONE',
    schema_drift_profile: 'BASELINE_THEN_DRIFT',
    global_processing: 'STREAM_DEFAULT',
    route_inheritance: 'MIXED_OVERRIDE',
    route_transform_override: 'OFF',
    route_protection_override: 'OFF',
    route_classification_override: 'OFF',
    route_policy_override: 'OFF',
    runtime_condition: 'NOMINAL',
    ...over,
  }
}

function logs(stages: string[]) {
  return { logs: stages.map((stage) => ({ stage })) }
}

// --- count / runtime executed ---
{
  const c = countDeliveryStages(logs(['run_started', 'route_send_success', 'run_complete']))
  assert.equal(c.route_send_success, 1)
  assert.equal(c.run_complete, 1)
  assert.ok(runtimeWasExecuted(c))
}
{
  const c = countDeliveryStages({ logs: [] })
  assert.equal(c.total_rows, 0)
  assert.equal(runtimeWasExecuted(c), false)
  const actual = deriveActualDeliveryOutcome({
    routeKey: 'route-primary',
    stages: c,
    collectorNewCount: 0,
    oracleExpected: 'delivered',
  })
  assert.equal(actual, 'runtime_not_executed')
  const check = assertDeliveryOutcomeConsistency({
    routeKey: 'route-primary',
    expected: 'delivered',
    actual,
    stages: c,
    collectorNewCount: 0,
  })
  assert.equal(check.ok, false)
  assert.match(String(check.detail), /runtime_not_executed/)
}

// --- H: HTTP 2xx + telemetry 0 → SILENT_RUNTIME_NOOP (must FAIL, never PASS) ---
{
  const c = countDeliveryStages({ logs: [] })
  const silent = detectSilentRuntimeNoop({ httpOk: true, stages: c, runtimeRunId: null })
  assert.equal(silent.silent, true)
  assert.equal(silent.code, 'SILENT_RUNTIME_NOOP')
  assert.match(String(silent.detail), /SILENT_RUNTIME_NOOP|lifecycle telemetry missing/i)
}
{
  const c = countDeliveryStages(logs(['run_started', 'run_complete']))
  const silent = detectSilentRuntimeNoop({ httpOk: true, stages: c, runtimeRunId: 'rid-1' })
  assert.equal(silent.silent, false)
}
{
  const c = countDeliveryStages({ logs: [] })
  const silent = detectSilentRuntimeNoop({ httpOk: false, stages: c })
  assert.equal(silent.silent, false)
}

// --- dynamic_route_send_success counts as send success ---
{
  const c = countDeliveryStages(
    logs(['run_started', 'dynamic_route_send_success', 'run_complete']),
  )
  assert.equal(c.dynamic_route_send_success, 1)
  assert.equal(
    deriveActualDeliveryOutcome({ routeKey: 'route-1', stages: c, collectorNewCount: 1 }),
    'delivered',
  )
}

// --- lifecycle flood without send stages must not become delivered ---
{
  const flooded = {
    logs: Array.from({ length: 50 }, (_, i) => ({
      stage: ['run_started', 'source_fetch', 'parse', 'dedup_queue_insert', 'run_complete'][i % 5],
    })),
  }
  const c = countDeliveryStages(flooded)
  assert.equal(c.route_send_success, 0)
  assert.equal(
    deriveActualDeliveryOutcome({
      routeKey: 'route-syslog',
      stages: c,
      collectorNewCount: 1,
      oracleExpected: 'delivered',
    }),
    'unknown',
  )
}

// --- TLS handshake failure → failed ---
{
  const c = countDeliveryStages(
    logs(['run_started', 'route_send_failed', 'run_complete']),
  )
  const actual = deriveActualDeliveryOutcome({
    routeKey: 'route-1',
    stages: c,
    collectorNewCount: 0,
  })
  assert.equal(actual, 'failed')
  assert.equal(
    assertDeliveryOutcomeConsistency({
      routeKey: 'route-1',
      expected: 'failed',
      actual,
      stages: c,
      collectorNewCount: 0,
    }).ok,
    true,
  )
}

// --- success requires send + collector ---
{
  const c = countDeliveryStages(logs(['run_started', 'route_send_success', 'run_complete']))
  assert.equal(
    deriveActualDeliveryOutcome({ routeKey: 'route-1', stages: c, collectorNewCount: 0 }),
    'failed',
  )
  assert.equal(
    deriveActualDeliveryOutcome({ routeKey: 'route-1', stages: c, collectorNewCount: 2 }),
    'delivered',
  )
}

// --- Oracle must not force delivered without evidence (negative harness rule) ---
{
  const c = countDeliveryStages({ logs: [] })
  const actual = deriveActualDeliveryOutcome({
    routeKey: 'route-primary',
    stages: c,
    collectorNewCount: 0,
    oracleExpected: 'delivered',
  })
  assert.notEqual(actual, 'delivered')
}

// --- Failover: primary failed + standby delivered ---
{
  const c = countDeliveryStages(
    logs([
      'run_started',
      'route_send_failed',
      'failover_route_attempt',
      'failover_route_send_success',
      'run_complete',
    ]),
  )
  assert.equal(
    deriveActualDeliveryOutcome({
      routeKey: 'route-primary',
      stages: c,
      collectorNewCount: 0,
      oracleExpected: 'failed',
    }),
    'failed',
  )
  assert.equal(
    deriveActualDeliveryOutcome({
      routeKey: 'route-failover',
      stages: c,
      collectorNewCount: 4,
      oracleExpected: 'failover',
    }),
    'failover',
  )
  assert.equal(
    assertDeliveryOutcomeConsistency({
      routeKey: 'route-primary',
      expected: 'failed',
      actual: 'failed',
      stages: c,
      collectorNewCount: 0,
    }).ok,
    true,
  )
  assert.equal(
    assertDeliveryOutcomeConsistency({
      routeKey: 'route-failover',
      expected: 'failover',
      actual: 'failover',
      stages: c,
      collectorNewCount: 4,
    }).ok,
    true,
  )
}

// --- Both primary and failover fail ---
{
  const c = countDeliveryStages(
    logs([
      'run_started',
      'route_send_failed',
      'failover_route_attempt',
      'failover_route_send_failed',
      'run_complete',
    ]),
  )
  assert.equal(
    deriveActualDeliveryOutcome({
      routeKey: 'route-primary',
      stages: c,
      collectorNewCount: 0,
    }),
    'failed',
  )
  assert.equal(
    deriveActualDeliveryOutcome({
      routeKey: 'route-failover',
      stages: c,
      collectorNewCount: 0,
    }),
    'failed',
  )
}

// --- Oracle axes for FAILOVER_ON_DESTINATION_FAILURE ---
{
  const oracle = computeOracle(
    baseAxes({
      route_topology: 'FAILOVER_ROUTE',
      failover_mode: 'FAILOVER_ON_DESTINATION_FAILURE',
      source_type: 'REMOTE_FILE_POLLING',
      destination_type: 'SYSLOG_TLS',
    }),
    'xp_2174788756725a6c6331b9db',
  )
  const primary = oracle.routes.find((r) => r.route_key === 'route-primary')
  const standby = oracle.routes.find((r) => r.route_key === 'route-failover')
  assert.ok(primary && standby)
  assert.equal(primary!.delivery_outcome, 'failed')
  assert.equal(primary!.collector_count, 0)
  assert.equal(primary!.collector_correlation_ids.length, 0)
  assert.equal(standby!.delivery_outcome, 'failover')
  assert.ok(standby!.collector_correlation_ids.length > 0)
}

// --- Source matrix oracle single-route SYSLOG_TLS ---
for (const source_type of ['HTTP_API_POLLING', 'S3_OBJECT_POLLING', 'REMOTE_FILE_POLLING'] as const) {
  const oracle = computeOracle(
    baseAxes({
      source_type,
      source_auth: source_type === 'HTTP_API_POLLING' ? 'none' : source_type === 'S3_OBJECT_POLLING' ? 'aws_access_key' : 'ssh',
      destination_type: 'SYSLOG_TLS',
      route_topology: 'SINGLE_ROUTE',
    }),
    `xp_tls_${source_type}`,
  )
  assert.equal(oracle.routes[0]?.destination_type, 'SYSLOG_TLS')
  assert.equal(oracle.routes[0]?.delivery_outcome, 'delivered')
}

// --- evaluateRouteCollectorOutcome: failed primary with collector>0 is FAIL ---
{
  const route = {
    route_key: 'route-primary',
    destination_type: 'SYSLOG_TLS',
    delivery_outcome: 'failed',
    payloads: [] as Array<Record<string, unknown>>,
    collector_correlation_ids: [] as string[],
  }
  const plan = buildRouteCollectorPlan(route)
  const ev = evaluateRouteCollectorOutcome({
    route,
    plan,
    newCount: 3,
    hasPayload: true,
    deliverySucceeded: false,
    deliveryBehavior: 'continue',
  })
  assert.equal(ev.ok, false)
}

console.log('test-delivery-outcome: PASS')
