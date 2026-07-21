/**
 * Pure Expected-Result Oracle.
 * Uses fixture + scenario axes only — never Runtime observations.
 */
import type { CrossProductAxes } from './cross-product-types.js'
import {
  FIXTURE_FIELD_CONTRACT,
  buildBaselineEvents,
  buildDriftEvents,
  type FixtureEvent,
} from './fixtures/composite-chain-fixture.js'
import { sourceContractCorrelationIds } from './collector-route-plan.js'

export type RouteExpected = {
  route_key: string
  effective_transform: {
    field_mapping: boolean
    timestamp_normalization: boolean
    jsonata: boolean
    regex: boolean
    override: boolean
  }
  effective_protection: string
  effective_classification: string
  effective_policy: string
  destination_type: string
  delivery_outcome: 'delivered' | 'quarantined' | 'blocked' | 'failover' | 'failed'
  collector_count: number
  quarantine_count: number
  /** Final destination e2e_correlation_id values expected in collectors for this route. */
  collector_correlation_ids: string[]
  payloads: FixtureEvent[]
}

export type OracleResult = {
  union_schema_fields: string[]
  rare_fields: string[]
  checkpoint_advances_on_success_only: true
  dedup: {
    enabled: boolean
    duplicate_event_id: string
    expected_skip: boolean
  }
  drift: {
    unknown_normal: boolean
    unknown_sensitive: boolean
    field_added: boolean
    field_removed: boolean
    type_changed: boolean
  }
  unknown_field_result: {
    type: string
    policy: string
    action: 'pass_through' | 'drop_field' | 'quarantine' | 'auto_protect' | 'none'
  }
  sensitive_classification: {
    detection: string
    classification: string
  }
  transform_outputs: {
    mapping?: { from: string; to: string }
    timestamp?: { from: string; to: string }
    jsonata?: { from: string; to: string }
    regex?: { from: string; to: string }
  }
  routes: RouteExpected[]
  collector_total: number
  quarantine_total: number
  replay: { mode: string; expected: 'none' | 'reprocess_after_recovery' }
  failover: { mode: string; expected: 'none' | 'alternate_route_on_failure' }
  block_implies_adapter_not_called: boolean
}

function applyTransforms(ev: FixtureEvent, axes: CrossProductAxes): FixtureEvent {
  const out: FixtureEvent = { ...ev }
  if (axes.field_mapping === 'ON' && typeof out.map_src_host === 'string') {
    out[FIXTURE_FIELD_CONTRACT.mapping_output] = out.map_src_host
  }
  if (axes.timestamp_normalization === 'ON' && out.event_time != null) {
    const raw = String(out.event_time)
    // Oracle: non-ISO lab format → normalized ISO-like token; ISO left as-is marker
    if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
      out.event_time_normalized = '2026-07-02T09:15:30Z'
    } else {
      out.event_time_normalized = raw
    }
  }
  if (axes.jsonata === 'ON' && typeof out.jsonata_amount === 'number') {
    out[FIXTURE_FIELD_CONTRACT.jsonata_output] = out.jsonata_amount * 2
  }
  if (axes.regex === 'ON' && typeof out.regex_message === 'string') {
    const m = String(out.regex_message).match(/CODE=(\d+)/)
    if (m) out[FIXTURE_FIELD_CONTRACT.regex_output_code] = m[1]
  }
  return out
}

function applyProtection(ev: FixtureEvent, axes: CrossProductAxes): FixtureEvent {
  const out: FixtureEvent = { ...ev }
  const field = FIXTURE_FIELD_CONTRACT.sensitive_known
  if (!(field in out)) return out
  switch (axes.protection_action) {
    case 'audit':
      out._protection_audit = true
      break
    case 'mask_partial':
      out[field] = '************1111'
      break
    case 'tokenize':
      out[field] = `tok_${String(out[field]).slice(0, 4)}`
      break
    case 'hash':
      out[field] = `hash_${String(out[field]).length}`
      break
    case 'drop_field':
      delete out[field]
      break
  }
  return out
}

function applyUnknownPolicy(ev: FixtureEvent, axes: CrossProductAxes): {
  event: FixtureEvent | null
  quarantined: boolean
} {
  const out: FixtureEvent = { ...ev }
  const policy = axes.unknown_field_policy
  const hasNormal = FIXTURE_FIELD_CONTRACT.unknown_normal in out
  const hasSensitive = FIXTURE_FIELD_CONTRACT.unknown_sensitive in out

  if (axes.unknown_field_type === 'NONE' || policy === 'NONE') {
    return { event: out, quarantined: false }
  }
  if (policy === 'QUARANTINE' && ((axes.unknown_field_type === 'NORMAL' && hasNormal) || (axes.unknown_field_type === 'SENSITIVE' && hasSensitive))) {
    return { event: null, quarantined: true }
  }
  if (policy === 'DROP_FIELD') {
    if (axes.unknown_field_type === 'NORMAL') delete out[FIXTURE_FIELD_CONTRACT.unknown_normal]
    if (axes.unknown_field_type === 'SENSITIVE') delete out[FIXTURE_FIELD_CONTRACT.unknown_sensitive]
  }
  if (policy === 'AUTO_PROTECT' && hasSensitive) {
    out[FIXTURE_FIELD_CONTRACT.unknown_sensitive] = '***AUTO_PROTECTED***'
  }
  return { event: out, quarantined: false }
}

function routeKeys(axes: CrossProductAxes): string[] {
  switch (axes.route_topology) {
    case 'SINGLE_ROUTE':
      return ['route-0']
    case 'MULTI_ROUTE_ALL_INHERIT':
      return ['route-0', 'route-1']
    case 'MULTI_ROUTE_MIXED_TRANSFORM_OVERRIDE':
      return ['route-inherit', 'route-transform-override']
    case 'MULTI_ROUTE_MIXED_PROTECTION_OVERRIDE':
      return ['route-inherit', 'route-protection-override']
    case 'MULTI_ROUTE_MIXED_POLICY_OVERRIDE':
      return ['route-inherit', 'route-policy-override']
    case 'MULTI_ROUTE_MIXED_DESTINATION_TYPE':
      return ['route-webhook', 'route-syslog']
    case 'MULTI_ROUTE_SAME_DESTINATION_TYPE_DIFFERENT_INSTANCE':
      return ['route-dest-a', 'route-dest-b']
    case 'MULTI_ROUTE_MIXED_DELIVERY_OUTCOME':
      return ['route-continue', 'route-block']
    case 'FAILOVER_ROUTE':
      return ['route-primary', 'route-failover']
    default:
      return ['route-0']
  }
}

function destinationForRoute(axes: CrossProductAxes, routeKey: string): string {
  if (axes.route_topology === 'MULTI_ROUTE_MIXED_DESTINATION_TYPE') {
    return routeKey === 'route-syslog' ? 'SYSLOG_TCP' : 'WEBHOOK_POST'
  }
  return axes.destination_type
}

export function computeOracle(axes: CrossProductAxes, combinationId: string): OracleResult {
  const baseline = buildBaselineEvents({ combinationId })
  const drift = buildDriftEvents({ combinationId })
  const all = [...baseline, ...drift]

  const union = new Set<string>()
  for (const ev of all) Object.keys(ev).forEach((k) => union.add(k))
  if (axes.field_mapping === 'ON') union.add(FIXTURE_FIELD_CONTRACT.mapping_output)
  if (axes.timestamp_normalization === 'ON') union.add('event_time_normalized')
  if (axes.jsonata === 'ON') union.add(FIXTURE_FIELD_CONTRACT.jsonata_output)
  if (axes.regex === 'ON') union.add(FIXTURE_FIELD_CONTRACT.regex_output_code)

  const rare_fields = baseline.some((e) => FIXTURE_FIELD_CONTRACT.rare_field in e)
    ? [FIXTURE_FIELD_CONTRACT.rare_field]
    : []

  const dupId = `${combinationId}:base:0000`
  const dedupEnabled = axes.dedup_strategy === 'EVENT_ID_SKIP_DUPLICATE'

  const keys = routeKeys(axes)
  const routes: RouteExpected[] = []
  let collector_total = 0
  let quarantine_total = 0
  const contractCorrelationIds = sourceContractCorrelationIds(axes, combinationId)

  for (const route_key of keys) {
    const overrideTransform =
      axes.route_transform_override === 'ON' && route_key.includes('transform-override')
    const overrideProtection =
      axes.route_protection_override === 'ON' && route_key.includes('protection-override')
    const mixedBlock = axes.route_topology === 'MULTI_ROUTE_MIXED_DELIVERY_OUTCOME' && route_key === 'route-block'

    let delivery_outcome: RouteExpected['delivery_outcome'] = 'delivered'
    if (axes.delivery_behavior === 'block' || mixedBlock) delivery_outcome = 'blocked'
    else if (axes.delivery_behavior === 'quarantine') delivery_outcome = 'quarantined'
    else if (
      axes.route_topology === 'FAILOVER_ROUTE' &&
      axes.failover_mode === 'FAILOVER_ON_DESTINATION_FAILURE'
    ) {
      // True Active/Standby: primary must fail destination send; standby delivers.
      delivery_outcome = route_key === 'route-primary' ? 'failed' : 'failover'
    }

    const payloads: FixtureEvent[] = []
    let routeQuarantine = 0
    const seen = new Set<string>()

    // Oracle processes baseline then drift; duplicate in drift may skip
    for (const raw of all) {
      const id = String(raw.event_id)
      if (dedupEnabled && seen.has(id)) continue
      seen.add(id)

      let ev = applyTransforms(raw, axes)
      if (overrideTransform) {
        ev = { ...ev, route_transform_marker: route_key }
      }
      const protAxes = overrideProtection
        ? { ...axes, protection_action: 'hash' as const }
        : axes
      ev = applyProtection(ev, protAxes)
      // Logical route-scoped id (oracle identity). Collector-facing IDs live on
      // route.collector_correlation_ids and are also stamped onto payloads below.
      ev.correlation_id = `${combinationId}:${route_key}:${id}`
      if (axes.source_type === 'WEBHOOK_RECEIVER') {
        ev.e2e_correlation_id = combinationId
      } else if (contractCorrelationIds.length) {
        // Stamp a contract id so payload-level extraction remains possible; the
        // authoritative wait set is route.collector_correlation_ids (full list).
        ev.e2e_correlation_id = contractCorrelationIds[payloads.length % contractCorrelationIds.length]
      }

      const unknown = applyUnknownPolicy(ev, axes)
      if (unknown.quarantined) {
        routeQuarantine += 1
        continue
      }
      if (!unknown.event) continue
      ev = unknown.event

      if (delivery_outcome === 'delivered' || delivery_outcome === 'failover') {
        payloads.push(ev)
      }
    }

    const collector_count =
      delivery_outcome === 'blocked' ||
      delivery_outcome === 'quarantined' ||
      delivery_outcome === 'failed'
        ? 0
        : payloads.length
    const quarantine_count =
      delivery_outcome === 'quarantined' ? payloads.length + routeQuarantine : routeQuarantine

    // For quarantine delivery behavior, events go to quarantine not collector
    if (delivery_outcome === 'quarantined') {
      quarantine_total += all.length // approximate unique after dedup handled above
    } else {
      quarantine_total += routeQuarantine
    }
    collector_total += collector_count

    const deliveredPayloads =
      delivery_outcome === 'delivered' || delivery_outcome === 'failover' ? payloads : []
    routes.push({
      route_key,
      effective_transform: {
        field_mapping: axes.field_mapping === 'ON',
        timestamp_normalization: axes.timestamp_normalization === 'ON',
        jsonata: axes.jsonata === 'ON',
        regex: axes.regex === 'ON',
        override: overrideTransform,
      },
      effective_protection: overrideProtection ? 'hash' : axes.protection_action,
      effective_classification: axes.classification_profile,
      effective_policy: axes.unknown_field_policy,
      destination_type: destinationForRoute(axes, route_key),
      delivery_outcome,
      collector_count,
      quarantine_count,
      collector_correlation_ids:
        delivery_outcome === 'delivered' || delivery_outcome === 'failover'
          ? [...contractCorrelationIds]
          : [],
      payloads: deliveredPayloads,
    })
  }

  const unknownAction =
    axes.unknown_field_policy === 'NONE'
      ? 'none'
      : axes.unknown_field_policy === 'PASS_THROUGH'
        ? 'pass_through'
        : axes.unknown_field_policy === 'DROP_FIELD'
          ? 'drop_field'
          : axes.unknown_field_policy === 'QUARANTINE'
            ? 'quarantine'
            : 'auto_protect'

  return {
    union_schema_fields: [...union].sort(),
    rare_fields,
    checkpoint_advances_on_success_only: true,
    dedup: {
      enabled: dedupEnabled,
      duplicate_event_id: dupId,
      expected_skip: dedupEnabled,
    },
    drift: {
      unknown_normal: drift.some((e) => FIXTURE_FIELD_CONTRACT.unknown_normal in e),
      unknown_sensitive: drift.some((e) => FIXTURE_FIELD_CONTRACT.unknown_sensitive in e),
      field_added: drift.some((e) => 'field_added' in e),
      field_removed: true,
      type_changed: true,
    },
    unknown_field_result: {
      type: axes.unknown_field_type,
      policy: axes.unknown_field_policy,
      action: unknownAction,
    },
    sensitive_classification: {
      detection: axes.sensitive_detection_profile,
      classification: axes.classification_profile,
    },
    transform_outputs: {
      mapping:
        axes.field_mapping === 'ON'
          ? { from: FIXTURE_FIELD_CONTRACT.mapping_input, to: FIXTURE_FIELD_CONTRACT.mapping_output }
          : undefined,
      timestamp:
        axes.timestamp_normalization === 'ON'
          ? { from: FIXTURE_FIELD_CONTRACT.timestamp_source, to: 'event_time_normalized' }
          : undefined,
      jsonata:
        axes.jsonata === 'ON'
          ? { from: FIXTURE_FIELD_CONTRACT.jsonata_input, to: FIXTURE_FIELD_CONTRACT.jsonata_output }
          : undefined,
      regex:
        axes.regex === 'ON'
          ? { from: FIXTURE_FIELD_CONTRACT.regex_input, to: FIXTURE_FIELD_CONTRACT.regex_output_code }
          : undefined,
    },
    routes,
    collector_total,
    quarantine_total,
    replay: {
      mode: axes.replay_mode,
      expected: axes.replay_mode === 'NONE' ? 'none' : 'reprocess_after_recovery',
    },
    failover: {
      mode: axes.failover_mode,
      expected: axes.failover_mode === 'NONE' ? 'none' : 'alternate_route_on_failure',
    },
    block_implies_adapter_not_called: axes.delivery_behavior === 'block',
  }
}

export function fieldLevelDiff(
  expected: FixtureEvent,
  actual: FixtureEvent,
): Array<{ field: string; expected: unknown; actual: unknown }> {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
  const diffs: Array<{ field: string; expected: unknown; actual: unknown }> = []
  for (const k of keys) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(actual[k])) {
      diffs.push({ field: k, expected: expected[k], actual: actual[k] })
    }
  }
  return diffs
}
