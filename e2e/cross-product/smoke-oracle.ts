#!/usr/bin/env npx tsx
import { assertRareFieldRatio, buildBaselineEvents, buildDriftEvents } from './fixtures/composite-chain-fixture.js'
import { computeOracle } from './oracle.js'
import type { CrossProductAxes } from './cross-product-types.js'

const baseline = buildBaselineEvents({ combinationId: 'xp_test' })
assertRareFieldRatio(baseline)
const drift = buildDriftEvents({ combinationId: 'xp_test' })
console.log(JSON.stringify({ baseline: baseline.length, drift: drift.length }))

const axes = {
  execution_surface: 'API_SEEDED',
  route_runtime: 'ROUTE_ON',
  source_type: 'HTTP_API_POLLING',
  source_auth: 'no_auth',
  source_configuration_profile: 'DEFAULT',
  collection_mode: 'POLLING',
  payload_format: 'JSON',
  record_path_event_root_profile: 'NESTED_DATA_EVENTS',
  union_schema_profile: 'BASELINE_WITH_RARE',
  incremental_fetch: 'OFF',
  checkpoint_strategy: 'NONE',
  dedup_strategy: 'EVENT_ID_SKIP_DUPLICATE',
  schema_drift_profile: 'BASELINE_THEN_DRIFT',
  unknown_field_type: 'SENSITIVE',
  unknown_field_policy: 'AUTO_PROTECT',
  sensitive_detection_profile: 'ON',
  classification_profile: 'CONFIDENTIAL',
  field_mapping: 'ON',
  timestamp_normalization: 'ON',
  jsonata: 'ON',
  regex: 'ON',
  global_processing: 'STREAM_DEFAULT',
  route_topology: 'SINGLE_ROUTE',
  route_inheritance: 'ALL_INHERIT',
  route_transform_override: 'OFF',
  route_protection_override: 'OFF',
  route_classification_override: 'OFF',
  route_policy_override: 'OFF',
  protection_action: 'mask_partial',
  delivery_behavior: 'continue',
  destination_type: 'WEBHOOK_POST',
  destination_auth_protocol: 'NONE',
  runtime_condition: 'NOMINAL',
  fault_type: 'NONE',
  replay_mode: 'NONE',
  failover_mode: 'NONE',
} satisfies CrossProductAxes

const o = computeOracle(axes, 'xp_test')
console.log(
  JSON.stringify({
    routes: o.routes.length,
    collector: o.collector_total,
    dedup: o.dedup,
    transforms: o.transform_outputs,
  }),
)
console.log('ORACLE_OK')
