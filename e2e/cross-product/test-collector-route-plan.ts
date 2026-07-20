#!/usr/bin/env npx tsx
/**
 * Regression + negative tests for per-route collector correlation verification.
 *
 * Covers:
 * - REMOTE_FILE_POLLING + Transform + WEBHOOK + SYSLOG_TCP + two routes + continue
 * - Source-fixture-only correlations without route final correlations → FAIL
 */
import assert from 'node:assert/strict'
import {
  buildAllRouteCollectorPlans,
  buildRouteCollectorPlan,
  evaluateRouteCollectorOutcome,
  sourceContractCorrelationIds,
  type RouteCollectorInput,
} from './collector-route-plan.js'
import { computeOracle } from './oracle.js'
import type { CrossProductAxes } from './cross-product-types.js'

function baseAxes(over: Partial<CrossProductAxes> = {}): CrossProductAxes {
  return {
    execution_surface: 'API_SEEDED',
    route_runtime: 'ROUTE_ON',
    source_type: 'REMOTE_FILE_POLLING',
    source_auth: 'ssh',
    destination_type: 'SYSLOG_TCP',
    destination_auth_protocol: 'NONE',
    route_topology: 'MULTI_ROUTE_MIXED_DESTINATION_TYPE',
    field_mapping: 'ON',
    timestamp_normalization: 'ON',
    jsonata: 'ON',
    regex: 'ON',
    protection_action: 'audit',
    delivery_behavior: 'continue',
    incremental_fetch: 'OFF',
    dedup_strategy: 'EVENT_ID_SKIP_DUPLICATE',
    unknown_field_type: 'SENSITIVE',
    unknown_field_policy: 'DROP_FIELD',
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
    route_inheritance: 'ALL_INHERIT',
    route_transform_override: 'OFF',
    route_protection_override: 'OFF',
    route_classification_override: 'OFF',
    route_policy_override: 'OFF',
    runtime_condition: 'NOMINAL',
    ...over,
  }
}

function main(): void {
  const combinationId = 'xp_f07dfbafa21b1efc3fe21448'
  const axes = baseAxes()
  const oracle = computeOracle(axes, combinationId)
  assert.equal(oracle.routes.length, 2, 'two routes')

  const plans = buildAllRouteCollectorPlans(oracle.routes)
  const webhook = plans.find((p) => p.route_key === 'route-webhook')
  const syslog = plans.find((p) => p.route_key === 'route-syslog')
  assert.ok(webhook, 'webhook plan')
  assert.ok(syslog, 'syslog plan')

  // Each route uses final payload / route collector_correlation_ids (not a global fixture-only wait).
  assert.ok(webhook.expected_correlation_ids.length > 0, 'webhook expected correlations')
  assert.ok(syslog.expected_correlation_ids.length > 0, 'syslog expected correlations')
  assert.deepEqual(
    webhook.expected_correlation_ids,
    sourceContractCorrelationIds(axes, combinationId),
    'webhook waits on route final e2e correlations from oracle route plan',
  )
  assert.deepEqual(
    syslog.expected_correlation_ids,
    sourceContractCorrelationIds(axes, combinationId),
    'syslog waits on its own route final correlations',
  )

  // Independent collector selection — never merge webhook+syslog into one query.
  assert.equal(webhook.collector_kind, 'webhook')
  assert.equal(webhook.protocol, undefined)
  assert.equal(webhook.destination_type, 'WEBHOOK_POST')
  assert.equal(syslog.collector_kind, 'syslog')
  assert.equal(syslog.protocol, 'tcp')
  assert.equal(syslog.destination_type, 'SYSLOG_TCP')
  assert.notEqual(
    `${webhook.collector_kind}:${webhook.protocol ?? ''}`,
    `${syslog.collector_kind}:${syslog.protocol ?? ''}`,
    'webhook and syslog use distinct collector conditions',
  )

  // Logical route-scoped correlation_id is recorded separately and must be route-prefixed.
  assert.ok(
    webhook.logical_correlation_ids.every((id) => id.includes(':route-webhook:')),
    'logical webhook correlations are route-scoped',
  )
  assert.ok(
    syslog.logical_correlation_ids.every((id) => id.includes(':route-syslog:')),
    'logical syslog correlations are route-scoped',
  )

  // Simulated independent collector results → both routes payload_match, no false COLLECTOR mismatch.
  for (const [route, plan] of [
    [oracle.routes[0]!, webhook] as const,
    [oracle.routes[1]!, syslog] as const,
  ]) {
    const ev = evaluateRouteCollectorOutcome({
      route,
      plan,
      newCount: 4,
      hasPayload: true,
      deliverySucceeded: true,
      deliveryBehavior: 'continue',
      sourceFixtureOnlyIds: sourceContractCorrelationIds(axes, combinationId),
    })
    assert.equal(ev.ok, true, `${plan.route_key} should PASS`)
    assert.equal(ev.payload_match, true, `${plan.route_key} payload_match`)
    assert.equal(ev.runtime_collector_mismatch, 0, `${plan.route_key} no mismatch`)
  }

  // Negative: Source fixture correlations alone without route final correlations → FAIL.
  const bare: RouteCollectorInput = {
    route_key: 'route-webhook',
    destination_type: 'WEBHOOK_POST',
    delivery_outcome: 'delivered',
    collector_correlation_ids: [],
    payloads: [
      // only logical id missing e2e / collector_correlation_ids → no wait set
      { event_id: 'x', correlation_id: undefined },
    ],
  }
  const barePlan = buildRouteCollectorPlan(bare)
  assert.deepEqual(barePlan.expected_correlation_ids, [], 'no route final correlations')
  const neg = evaluateRouteCollectorOutcome({
    route: bare,
    plan: barePlan,
    newCount: 4, // source fixture rows present in collector
    hasPayload: true,
    deliverySucceeded: true,
    deliveryBehavior: 'continue',
    sourceFixtureOnlyIds: sourceContractCorrelationIds(axes, combinationId),
  })
  assert.equal(neg.ok, false, 'negative: source-fixture-only must FAIL')
  assert.equal(neg.classification, 'COLLECTOR')
  assert.match(String(neg.detail), /missing route final correlation_ids/)
  assert.match(String(neg.detail), /source fixture correlations present but not usable/)

  // SYSLOG protocol selection follows destination_type.
  assert.equal(buildRouteCollectorPlan({
    route_key: 'r',
    destination_type: 'SYSLOG_UDP',
    delivery_outcome: 'delivered',
    collector_correlation_ids: ['a'],
    payloads: [],
  }).protocol, 'udp')
  assert.equal(buildRouteCollectorPlan({
    route_key: 'r',
    destination_type: 'SYSLOG_TLS',
    delivery_outcome: 'delivered',
    collector_correlation_ids: ['a'],
    payloads: [],
  }).protocol, 'tls')

  console.log(JSON.stringify({
    status: 'PASS',
    tests: [
      'remote_file_multi_route_transform_continue_independent_collectors',
      'negative_source_fixture_only_without_route_final_correlations',
      'syslog_protocol_selection',
    ],
  }, null, 2))
}

main()
