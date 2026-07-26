/**
 * Per-route collector verification plan for Cross-Product harness.
 *
 * Collector waits must use Route final-output correlation IDs (from oracle route
 * payloads / route collector_correlation_ids), never a lone Source-fixture list
 * applied globally across mixed destinations.
 */
import type { CrossProductAxes } from './cross-product-types.js'

/** Minimal route shape — avoids circular import with oracle.ts */
export type RouteCollectorInput = {
  route_key: string
  destination_type: string
  delivery_outcome: string
  collector_correlation_ids?: string[]
  payloads: Array<Record<string, unknown>>
}

export type CollectorKind = 'webhook' | 'syslog'

export type RouteCollectorPlan = {
  route_key: string
  destination_type: string
  collector_kind: CollectorKind
  protocol: string | undefined
  expected_correlation_ids: string[]
  logical_correlation_ids: string[]
}

export type RouteCollectorEvidence = {
  route_key: string
  destination_type: string
  collector_kind: CollectorKind
  protocol: string | undefined
  expected_correlation_ids: string[]
  baseline_count: number
  all_matching_count: number
  new_count: number
  payload_match: boolean
  delivery_outcome: string
  error?: string
}

/** Source-contract correlation IDs present in lab fixtures / webhook pushes. */
export function sourceContractCorrelationIds(
  axes: CrossProductAxes,
  combinationId: string,
): string[] {
  switch (axes.source_type) {
    case 'WEBHOOK_RECEIVER':
      return [combinationId]
    case 'S3_OBJECT_POLLING':
      return [
        'full-e2e-corr-s3-init-1',
        'full-e2e-corr-s3-new-1',
        'full-e2e-corr-s3-dup-1',
        'full-e2e-corr-s3-nested-1',
      ]
    case 'REMOTE_FILE_POLLING':
      return [
        'full-e2e-corr-sftp-init-1',
        'full-e2e-corr-sftp-new-1',
        'full-e2e-corr-sftp-append-1',
        'full-e2e-corr-sftp-ko-1',
      ]
    case 'DATABASE_QUERY':
      return ['full-e2e-corr-db-1', 'full-e2e-corr-db-2', 'full-e2e-corr-db-3', 'full-e2e-corr-db-new']
    case 'HTTP_API_POLLING':
    default: {
      const auth = axes.source_auth
      if (auth === 'basic') return ['full-e2e-corr-basic-1']
      if (auth === 'bearer') return ['full-e2e-corr-bearer-1']
      if (auth === 'api_key_header' || auth === 'api_key_query') return ['full-e2e-corr-apikey-1']
      // session_login / no_auth / oauth fixtures share the lab noauth correlation id
      if (auth === 'session_login' || auth === 'no_auth' || auth === 'oauth2_client_credentials' || auth === 'jwt_refresh_token' || auth === 'vendor_jwt_exchange') {
        return ['full-e2e-corr-noauth-1']
      }
      return ['full-e2e-corr-noauth-1']
    }
  }
}

export function collectorKindForDestination(destinationType: string): CollectorKind {
  return destinationType.startsWith('SYSLOG') ? 'syslog' : 'webhook'
}

/** Syslog destinations require the real protocol; webhook omits protocol. */
export function collectorProtocolForDestination(destinationType: string): string | undefined {
  if (destinationType === 'SYSLOG_TLS') return 'tls'
  if (destinationType === 'SYSLOG_TCP') return 'tcp'
  if (destinationType === 'SYSLOG_UDP') return 'udp'
  return undefined
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    if (v == null) continue
    const s = String(v).trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * Final-output collector correlations for a route.
 * Prefer explicit route.collector_correlation_ids (complete wait set), then
 * e2e_correlation_id on payloads. Never invent Source-fixture IDs here.
 */
export function routeFinalCorrelationIds(route: RouteCollectorInput): string[] {
  const fromRouteField = uniqueStrings(route.collector_correlation_ids ?? [])
  if (fromRouteField.length) return fromRouteField

  const fromE2e = uniqueStrings(
    route.payloads.map((p) =>
      p.e2e_correlation_id != null ? String(p.e2e_correlation_id) : undefined,
    ),
  )
  if (fromE2e.length) return fromE2e

  return []
}

export function routeLogicalCorrelationIds(route: RouteCollectorInput): string[] {
  return uniqueStrings(
    route.payloads.map((p) => (p.correlation_id != null ? String(p.correlation_id) : undefined)),
  )
}

export function buildRouteCollectorPlan(route: RouteCollectorInput): RouteCollectorPlan {
  return {
    route_key: route.route_key,
    destination_type: route.destination_type,
    collector_kind: collectorKindForDestination(route.destination_type),
    protocol: collectorProtocolForDestination(route.destination_type),
    expected_correlation_ids: routeFinalCorrelationIds(route),
    logical_correlation_ids: routeLogicalCorrelationIds(route),
  }
}

export function buildAllRouteCollectorPlans(routes: RouteCollectorInput[]): RouteCollectorPlan[] {
  return routes.map((r) => buildRouteCollectorPlan(r))
}

export function collectorHasNonEmptyPayload(messages: unknown[]): boolean {
  return messages.some((m) => {
    const row = m as { body?: unknown; parsed_json?: unknown; payload?: unknown; message?: unknown }
    const payload = row.body ?? row.parsed_json ?? row.payload ?? row.message ?? m
    const text = JSON.stringify(payload ?? '')
    return text.length > 2 && text !== 'null' && text !== '""' && text !== '{}'
  })
}

/**
 * Evaluate one route's collector outcome.
 * When delivery is expected but route final correlations are missing, FAIL even if
 * Source-fixture rows exist in the collector (negative contract).
 */
export function evaluateRouteCollectorOutcome(opts: {
  route: RouteCollectorInput
  plan: RouteCollectorPlan
  newCount: number
  hasPayload: boolean
  deliverySucceeded: boolean
  deliveryBehavior: CrossProductAxes['delivery_behavior']
  sourceFixtureOnlyIds?: string[]
}): {
  ok: boolean
  classification?: string
  detail?: string
  payload_match: boolean
  runtime_collector_mismatch: number
} {
  const expectZero =
    opts.route.delivery_outcome === 'blocked' ||
    opts.route.delivery_outcome === 'quarantined' ||
    opts.route.delivery_outcome === 'failed'
  const expectDelivered =
    opts.route.delivery_outcome === 'delivered' || opts.route.delivery_outcome === 'failover'
  let runtime_collector_mismatch = 0
  let ok = true
  let classification: string | undefined
  let detail: string | undefined

  const payload_match = expectZero
    ? opts.newCount === 0
    : opts.newCount > 0 && opts.hasPayload

  if (expectDelivered && opts.plan.expected_correlation_ids.length === 0) {
    ok = false
    classification = 'COLLECTOR'
    detail =
      `missing route final correlation_ids for ${opts.route.route_key}` +
      (opts.sourceFixtureOnlyIds?.length
        ? ` (source fixture correlations present but not usable as route final: ${JSON.stringify(opts.sourceFixtureOnlyIds)})`
        : '')
    runtime_collector_mismatch += 1
    return { ok, classification, detail, payload_match: false, runtime_collector_mismatch }
  }

  if (expectZero && opts.newCount !== 0) {
    if (
      opts.route.delivery_outcome === 'failed' ||
      opts.deliveryBehavior === 'block' ||
      opts.deliveryBehavior === 'quarantine'
    ) {
      ok = false
      classification = opts.route.delivery_outcome === 'failed' ? 'RUNTIME' : 'GOVERNANCE'
      detail = `collector expected 0 for ${opts.route.delivery_outcome} got ${opts.newCount}`
      runtime_collector_mismatch += 1
    }
  }

  if (expectZero && opts.deliveryBehavior === 'block' && opts.newCount === 0 && opts.deliverySucceeded) {
    ok = false
    classification = 'GOVERNANCE'
    detail = 'block expected no delivery success but delivery logs show route_send_success'
    runtime_collector_mismatch += 1
  }

  if (!expectZero && opts.newCount === 0) {
    ok = false
    classification = 'COLLECTOR'
    detail = `Runtime↔Collector mismatch: expected delivery for ${opts.route.route_key} but collector_count=0 (waited=${JSON.stringify(opts.plan.expected_correlation_ids)} kind=${opts.plan.collector_kind} protocol=${opts.plan.protocol ?? 'n/a'})`
    runtime_collector_mismatch += 1
  }

  if (expectDelivered && opts.deliverySucceeded && opts.newCount === 0) {
    ok = false
    classification = 'COLLECTOR'
    detail = `Delivery success but collector_count=0 for ${opts.route.route_key} (waited=${JSON.stringify(opts.plan.expected_correlation_ids)})`
    runtime_collector_mismatch += 1
  }

  if (
    expectDelivered &&
    (opts.deliveryBehavior === 'continue' ||
      opts.route.delivery_outcome === 'delivered' ||
      opts.route.delivery_outcome === 'failover') &&
    opts.newCount > 0 &&
    !opts.hasPayload
  ) {
    ok = false
    classification = 'COLLECTOR'
    detail = `Continue/delivered requires collector payload; got empty payloads (count=${opts.newCount})`
  }

  return { ok, classification, detail, payload_match, runtime_collector_mismatch }
}
