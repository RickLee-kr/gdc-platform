import type { PipelineOutput } from '../subject/pipeline.js'
import type { OracleExpectation } from '../oracle/oracle-contract.js'

export type AssertResult = { ok: boolean; failed: string[] }

function pick(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f in obj) out[f] = obj[f]
  }
  return out
}

export function assertGoldenResult(opts: {
  out: PipelineOutput
  oracle: OracleExpectation
  expectedCollector: { payload?: Record<string, unknown>; route_key?: string; correlation_id?: string; destination_type?: string }[]
  expectedDelivery: { status: string; route_key?: string; destination_type?: string; retry_count?: number }[]
  expectedRuntime: Record<string, unknown>
  expectedNoDelivery: boolean
  verificationFields: string[]
  correlationId: string
}): AssertResult {
  const failed: string[] = []
  const { out, oracle } = opts

  if (Boolean(out.auth_ok) !== Boolean(oracle.auth_ok)) failed.push('auth_ok_mismatch')

  const successCount = out.delivery_log.filter((d) => d.status === 'SUCCESS').length
  if (opts.expectedNoDelivery) {
    if (successCount > 0) failed.push('expected_no_delivery_but_success')
    if (out.collector.length > 0) failed.push('expected_no_delivery_but_collector_received')
  }

  if (out.contract_errors.length) failed.push(...out.contract_errors.map((e) => `contract:${e}`))
  if (out.correlation_errors.length) failed.push(...out.correlation_errors.map((e) => `correlation:${e}`))

  // Delivery statuses
  const actualStatuses = out.delivery_log.map((d) => d.status)
  const expectedStatuses = opts.expectedDelivery.map((d) => d.status)
  if (JSON.stringify(actualStatuses) !== JSON.stringify(expectedStatuses)) {
    failed.push(`delivery_status_mismatch:actual=${actualStatuses.join(',')} expected=${expectedStatuses.join(',')}`)
  }

  // Collector count vs oracle
  if (out.collector.length !== oracle.collector_count) {
    failed.push(`collector_count_mismatch:actual=${out.collector.length} oracle=${oracle.collector_count}`)
  }

  // Collector zero false-pass guard
  if (successCount > 0 && out.collector.length === 0) {
    failed.push('collector_zero_with_delivery_success')
  }

  // Field-level checks against expected collector fixtures
  if (!opts.expectedNoDelivery && opts.expectedCollector.length) {
    for (let i = 0; i < opts.expectedCollector.length; i++) {
      const exp = opts.expectedCollector[i]
      const act = out.collector[i]
      if (!act) {
        failed.push(`collector_missing_index_${i}`)
        continue
      }
      if (exp.route_key && act.route_key !== exp.route_key) failed.push(`route_key_mismatch_${i}`)
      if (exp.correlation_id && act.correlation_id !== exp.correlation_id) failed.push(`correlation_id_mismatch_${i}`)
      if (exp.destination_type && act.destination_type !== exp.destination_type) {
        failed.push(`destination_type_mismatch_${i}`)
      }
      const fields = opts.verificationFields.filter((f) => f !== 'delivery_status' && f !== 'route_key' && f !== 'checkpoint_advanced' && f !== 'checkpoint_cursor' && f !== 'duplicate_skipped' && f !== 'retry_count' && f !== 'collector_count')
      if (exp.payload) {
        const ep = pick(exp.payload, fields.length ? fields : Object.keys(exp.payload))
        const ap = pick(act.payload, Object.keys(ep))
        if (JSON.stringify(ap) !== JSON.stringify(ep)) {
          failed.push(`collector_payload_mismatch_${i}:${JSON.stringify(ap)}!=${JSON.stringify(ep)}`)
        }
        // Drop/absence checks: verification fields missing in expected must not appear in actual
        for (const f of fields) {
          if (!(f in exp.payload) && f in act.payload) {
            failed.push(`collector_payload_mismatch_${i}:unexpected_field_${f}`)
          }
        }
        // Sensitive plaintext guards
        if (typeof exp.payload.email === 'string' && exp.payload.email.includes('@') === false) {
          if (String(act.payload.email || '').includes('@')) failed.push('mask_policy_plaintext_present')
        }
      }
      if (act.correlation_id !== opts.correlationId) failed.push('collector_correlation_mismatch')
    }
  }

  // Runtime expectations
  if (opts.expectedRuntime.checkpoint_advanced != null && out.checkpoint_advanced !== opts.expectedRuntime.checkpoint_advanced) {
    failed.push('checkpoint_not_advanced')
  }
  if (opts.expectedRuntime.checkpoint_cursor != null && out.checkpoint_cursor !== opts.expectedRuntime.checkpoint_cursor) {
    failed.push('checkpoint_cursor_mismatch')
  }
  if (opts.expectedRuntime.duplicate_skipped != null && out.duplicate_skipped !== opts.expectedRuntime.duplicate_skipped) {
    failed.push('dedup_mismatch')
  }
  if (opts.expectedRuntime.collector_count != null && out.collector.length !== opts.expectedRuntime.collector_count) {
    failed.push('runtime_collector_count_mismatch')
  }
  if (opts.expectedRuntime.retry_count != null) {
    const rc = out.delivery_log[0]?.retry_count
    if (rc !== opts.expectedRuntime.retry_count) failed.push('retry_count_mismatch')
  }

  // Oracle payload field compare for verification fields present in oracle
  for (const [routeKey, payloads] of Object.entries(oracle.payloads_by_route)) {
    const actual = out.route_payloads[routeKey] || []
    if (actual.length !== payloads.length) {
      failed.push(`oracle_route_count_mismatch:${routeKey}`)
      continue
    }
    for (let i = 0; i < payloads.length; i++) {
      for (const f of opts.verificationFields) {
        if (['delivery_status', 'route_key', 'checkpoint_advanced', 'checkpoint_cursor', 'duplicate_skipped', 'retry_count', 'collector_count'].includes(f)) continue
        if (f in payloads[i] && JSON.stringify(actual[i]?.[f]) !== JSON.stringify(payloads[i][f])) {
          failed.push(`oracle_field_mismatch:${routeKey}.${f}`)
        }
      }
    }
  }

  return { ok: failed.length === 0, failed }
}
