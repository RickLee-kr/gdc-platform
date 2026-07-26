/**
 * Derive actual delivery_outcome from Runtime telemetry + collector evidence.
 * Never copy Oracle expected values into actual results.
 */
export type ActualDeliveryOutcome =
  | 'delivered'
  | 'failed'
  | 'failover'
  | 'blocked'
  | 'quarantined'
  | 'unknown'
  | 'runtime_not_executed'

export type DeliveryStageCounts = {
  route_send_success: number
  route_send_failed: number
  route_retry_success: number
  route_retry_failed: number
  failover_route_attempt: number
  failover_route_send_success: number
  failover_route_send_failed: number
  destination_send_success: number
  dynamic_route_send_success: number
  run_complete: number
  run_started: number
  total_rows: number
}

const STAGE_KEYS: Array<keyof Omit<DeliveryStageCounts, 'total_rows'>> = [
  'route_send_success',
  'route_send_failed',
  'route_retry_success',
  'route_retry_failed',
  'failover_route_attempt',
  'failover_route_send_success',
  'failover_route_send_failed',
  'destination_send_success',
  'dynamic_route_send_success',
  'run_complete',
  'run_started',
]

export function countDeliveryStages(deliveryLogs: unknown): DeliveryStageCounts {
  const counts: DeliveryStageCounts = {
    route_send_success: 0,
    route_send_failed: 0,
    route_retry_success: 0,
    route_retry_failed: 0,
    failover_route_attempt: 0,
    failover_route_send_success: 0,
    failover_route_send_failed: 0,
    destination_send_success: 0,
    dynamic_route_send_success: 0,
    run_complete: 0,
    run_started: 0,
    total_rows: 0,
  }
  const rows =
    deliveryLogs && typeof deliveryLogs === 'object' && Array.isArray((deliveryLogs as { logs?: unknown }).logs)
      ? ((deliveryLogs as { logs: unknown[] }).logs)
      : Array.isArray(deliveryLogs)
        ? deliveryLogs
        : []
  counts.total_rows = rows.length
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const stage = String((row as { stage?: unknown }).stage || '').toLowerCase()
    for (const key of STAGE_KEYS) {
      if (stage === key) counts[key] += 1
    }
  }
  return counts
}

export function runtimeWasExecuted(stages: DeliveryStageCounts): boolean {
  return stages.total_rows > 0 && (stages.run_started > 0 || stages.run_complete > 0 || stages.route_send_success > 0 || stages.route_send_failed > 0)
}

/**
 * Detect the forbidden product state: HTTP 2xx run-once with zero lifecycle telemetry.
 * Harness must classify this as SILENT_RUNTIME_NOOP (product failure), never PASS.
 */
export function detectSilentRuntimeNoop(opts: {
  httpOk: boolean
  stages: DeliveryStageCounts
  runtimeRunId?: string | null
}): { silent: boolean; code?: string; detail?: string } {
  const { httpOk, stages, runtimeRunId } = opts
  if (!httpOk) return { silent: false }
  if (runtimeWasExecuted(stages)) return { silent: false }
  return {
    silent: true,
    code: 'SILENT_RUNTIME_NOOP',
    detail: `HTTP 2xx run-once but lifecycle telemetry missing (run_started=${stages.run_started} run_complete=${stages.run_complete} total_rows=${stages.total_rows} runtime_run_id=${runtimeRunId ?? 'null'})`,
  }
}

/**
 * Priority:
 * 1) runtime_not_executed when no meaningful telemetry
 * 2) failover path for route-failover
 * 3) success requires send success AND collector receipt
 * 4) failed when send failed and no success
 * 5) unknown otherwise
 */
export function deriveActualDeliveryOutcome(opts: {
  routeKey: string
  stages: DeliveryStageCounts
  collectorNewCount: number
  oracleExpected?: string
}): ActualDeliveryOutcome {
  const { routeKey, stages, collectorNewCount, oracleExpected } = opts

  if (oracleExpected === 'blocked') return 'blocked'
  if (oracleExpected === 'quarantined') return 'quarantined'

  if (!runtimeWasExecuted(stages)) {
    return 'runtime_not_executed'
  }

  const sendSuccess =
    stages.route_send_success +
    stages.destination_send_success +
    stages.route_retry_success +
    stages.dynamic_route_send_success
  const sendFailed = stages.route_send_failed + stages.route_retry_failed
  const foSuccess = stages.failover_route_send_success
  const foFailed = stages.failover_route_send_failed
  const foAttempt = stages.failover_route_attempt

  if (routeKey === 'route-failover' || routeKey.includes('failover')) {
    if (foSuccess > 0 && collectorNewCount > 0) return 'failover'
    if (foSuccess > 0 && collectorNewCount === 0) return 'failed'
    if (foFailed > 0 && foSuccess === 0) return 'failed'
    if (sendSuccess > 0 && collectorNewCount > 0) return 'delivered'
    if (sendFailed > 0 && sendSuccess === 0) return 'failed'
    return 'unknown'
  }

  // Active/Standby primary: product logs failover_route_attempt (+ standby success)
  // and may skip route_send_failed when standby recovers.
  if (routeKey === 'route-primary' && (foAttempt > 0 || foSuccess > 0 || foFailed > 0)) {
    if (sendSuccess === 0 && collectorNewCount === 0) return 'failed'
  }

  if (sendSuccess > 0 && collectorNewCount > 0) return 'delivered'
  if (sendFailed > 0 && sendSuccess === 0) return 'failed'
  if (sendSuccess > 0 && collectorNewCount === 0) return 'failed'
  if (sendFailed === 0 && sendSuccess === 0 && collectorNewCount === 0) return 'unknown'
  return 'unknown'
}

export function assertDeliveryOutcomeConsistency(opts: {
  routeKey: string
  expected: string
  actual: ActualDeliveryOutcome
  stages: DeliveryStageCounts
  collectorNewCount: number
}): { ok: boolean; detail?: string; classification?: string } {
  const { routeKey, expected, actual, stages, collectorNewCount } = opts

  if (actual === 'runtime_not_executed') {
    return {
      ok: false,
      classification: 'RUNTIME',
      detail: `runtime_not_executed for ${routeKey}: no run_started/run_complete/send telemetry (rows=${stages.total_rows})`,
    }
  }

  if (expected === 'delivered' || expected === 'failover') {
    if (actual === 'delivered' || actual === 'failover') {
      if (collectorNewCount <= 0) {
        return {
          ok: false,
          classification: 'COLLECTOR',
          detail: `expected ${expected} for ${routeKey} but collector_count=0`,
        }
      }
      if (expected === 'failover' && stages.failover_route_send_success <= 0) {
        return {
          ok: false,
          classification: 'RUNTIME',
          detail: `expected failover for ${routeKey} but failover_route_send_success=0`,
        }
      }
      return { ok: true }
    }
    return {
      ok: false,
      classification: 'RUNTIME',
      detail: `expected ${expected} for ${routeKey} but actual=${actual} (send_ok=${stages.route_send_success} send_fail=${stages.route_send_failed} fo_ok=${stages.failover_route_send_success} collector=${collectorNewCount})`,
    }
  }

  if (expected === 'failed') {
    if (actual !== 'failed') {
      return {
        ok: false,
        classification: 'RUNTIME',
        detail: `expected failed for ${routeKey} but actual=${actual}`,
      }
    }
    if (collectorNewCount !== 0) {
      return {
        ok: false,
        classification: 'COLLECTOR',
        detail: `expected failed for ${routeKey} requires collector_count=0 got ${collectorNewCount}`,
      }
    }
    const primaryFailEvidence =
      stages.route_send_failed > 0 ||
      stages.failover_route_attempt > 0 ||
      stages.failover_route_send_success > 0 ||
      stages.failover_route_send_failed > 0
    if (stages.route_send_success > 0 && routeKey === 'route-primary') {
      return {
        ok: false,
        classification: 'RUNTIME',
        detail: `expected primary failed but route_send_success=${stages.route_send_success}`,
      }
    }
    if (routeKey === 'route-primary' && !primaryFailEvidence) {
      return {
        ok: false,
        classification: 'RUNTIME',
        detail: `expected primary failed but missing route_send_failed/failover_route_* evidence`,
      }
    }
    return { ok: true }
  }

  if (expected === 'blocked' || expected === 'quarantined') {
    if (collectorNewCount !== 0) {
      return {
        ok: false,
        classification: 'GOVERNANCE',
        detail: `collector expected 0 for ${expected} got ${collectorNewCount}`,
      }
    }
    return { ok: true }
  }

  return { ok: true }
}
