export type DeliveryLogEntry = {
  correlation_id: string
  route_key: string
  destination_type: string
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'QUARANTINED'
  payload: Record<string, unknown> | null
  retry_count: number
}

export type DeliveryContractResult = {
  ok: boolean
  errors: string[]
}

/**
 * Delivery must not be SUCCESS when collector received 0 events (M19 target).
 */
export function assertDeliveryCollectorContract(opts: {
  delivery: DeliveryLogEntry[]
  collectorCount: number
  expectedNoDelivery?: boolean
}): DeliveryContractResult {
  const errors: string[] = []
  const success = opts.delivery.filter((d) => d.status === 'SUCCESS')
  if (opts.expectedNoDelivery) {
    if (success.length > 0) errors.push('expected_no_delivery_but_success')
    if (opts.collectorCount > 0) errors.push('expected_no_delivery_but_collector_received')
    return { ok: errors.length === 0, errors }
  }
  if (success.length > 0 && opts.collectorCount === 0) {
    errors.push('collector_zero_with_delivery_success')
  }
  if (opts.collectorCount > 0 && success.length === 0) {
    errors.push('collector_payload_without_delivery_log')
  }
  if (success.length > 0 && opts.collectorCount === 0) {
    // keep explicit false-pass guard
    errors.push('false_pass_collector_zero')
  }
  return { ok: errors.length === 0, errors }
}

export function recordDelivery(entry: DeliveryLogEntry): DeliveryLogEntry {
  return { ...entry }
}
