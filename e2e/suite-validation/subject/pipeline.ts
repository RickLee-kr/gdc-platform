/**
 * Suite-validation subject pipeline — mutation target for product-contract defects.
 * Must NOT import app/runtime or e2e/cross-product/oracle.
 */
import { authenticateSource, sourceFetchOutcome, type AuthRequest } from './auth.js'
import { applyTransforms, type TransformConfig } from './transform.js'
import { applyGovernance, type GovernancePolicy } from './governance.js'
import { mergeRouteConfig, type RouteDefinition } from './route.js'
import { recordDelivery, assertDeliveryCollectorContract, type DeliveryLogEntry } from './delivery.js'
import { resetCollector, receiveToCollector, listCollector, assertCollectorCorrelation } from './collector.js'
import { createCheckpoint, applyDedup, advanceCheckpoint, recordRetry } from './checkpoint.js'

export type PipelineInput = {
  correlation_id: string
  auth: AuthRequest
  events: Record<string, unknown>[]
  global_transform: TransformConfig
  governance: GovernancePolicy
  routes: RouteDefinition[]
  route_mode: 'route-on' | 'route-off'
  dedup_enabled?: boolean
  incremental_cursor?: string
  collector_fail?: boolean
  retry_attempts?: number
  retry_final_ok?: boolean
}

export type PipelineOutput = {
  auth_ok: boolean
  auth_status: number
  delivery_log: DeliveryLogEntry[]
  collector: ReturnType<typeof listCollector>
  checkpoint_advanced: boolean
  checkpoint_cursor: string | null
  duplicate_skipped: number
  blocked: number
  quarantined: number
  transform_errors: string[]
  contract_errors: string[]
  correlation_errors: string[]
  route_payloads: Record<string, Record<string, unknown>[]>
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  resetCollector()
  const auth = authenticateSource(input.auth)
  const fetchOutcome = sourceFetchOutcome(auth)
  if (fetchOutcome !== 'success') {
    return {
      auth_ok: false,
      auth_status: auth.status,
      delivery_log: [],
      collector: [],
      checkpoint_advanced: false,
      checkpoint_cursor: null,
      duplicate_skipped: 0,
      blocked: 0,
      quarantined: 0,
      transform_errors: [],
      contract_errors: ['source_auth_failed'],
      correlation_errors: [],
      route_payloads: {},
    }
  }

  let cp = createCheckpoint()
  let duplicate_skipped = 0
  let blocked = 0
  let quarantined = 0
  const transform_errors: string[] = []
  const delivery_log: DeliveryLogEntry[] = []
  const route_payloads: Record<string, Record<string, unknown>[]> = {}

  const routes =
    input.route_mode === 'route-off'
      ? [
          {
            route_key: 'legacy',
            destination_type: input.routes[0]?.destination_type || 'WEBHOOK_POST',
          } satisfies RouteDefinition,
        ]
      : input.routes

  for (const raw of input.events) {
    const eventId = String(raw.event_id ?? raw.id ?? '')
    const dedup = applyDedup(cp, eventId, Boolean(input.dedup_enabled))
    cp = dedup.state
    if (dedup.duplicate) {
      duplicate_skipped += 1
      continue
    }

    for (const routeDef of routes) {
      const effective = mergeRouteConfig(input.global_transform, input.governance, routeDef)
      if (effective.policy === 'block') {
        blocked += 1
        delivery_log.push(
          recordDelivery({
            correlation_id: input.correlation_id,
            route_key: effective.route_key,
            destination_type: effective.destination_type,
            status: 'BLOCKED',
            payload: null,
            retry_count: 0,
          }),
        )
        continue
      }

      const transformed = applyTransforms(raw, effective.transform)
      transform_errors.push(...transformed.errors)
      if (transformed.errors.includes('invalid_timestamp')) {
        blocked += 1
        delivery_log.push(
          recordDelivery({
            correlation_id: input.correlation_id,
            route_key: effective.route_key,
            destination_type: effective.destination_type,
            status: 'BLOCKED',
            payload: null,
            retry_count: 0,
          }),
        )
        continue
      }

      const gov = applyGovernance(transformed.event, effective.governance)
      if (gov.action === 'block') {
        blocked += 1
        delivery_log.push(
          recordDelivery({
            correlation_id: input.correlation_id,
            route_key: effective.route_key,
            destination_type: effective.destination_type,
            status: 'BLOCKED',
            payload: null,
            retry_count: 0,
          }),
        )
        continue
      }
      if (gov.action === 'quarantine') {
        quarantined += 1
        delivery_log.push(
          recordDelivery({
            correlation_id: input.correlation_id,
            route_key: effective.route_key,
            destination_type: effective.destination_type,
            status: 'QUARANTINED',
            payload: gov.event,
            retry_count: 0,
          }),
        )
        continue
      }

      const payload = { ...(gov.event || {}), e2e_correlation_id: input.correlation_id }
      let status: DeliveryLogEntry['status'] = 'SUCCESS'
      let retry_count = 0
      if (input.collector_fail) {
        const retry = recordRetry({
          attempts: input.retry_attempts ?? 1,
          final_ok: input.retry_final_ok ?? false,
        })
        status = retry.status
        retry_count = retry.retry_count
      }

      // Adapter call on SUCCESS. collector_fail + retry_final_ok means recovered delivery.
      if (status === 'SUCCESS') {
        receiveToCollector({
          correlation_id: input.correlation_id,
          route_key: effective.route_key,
          destination_type: effective.destination_type,
          payload,
        })
        route_payloads[effective.route_key] = route_payloads[effective.route_key] || []
        route_payloads[effective.route_key].push(payload)
      }

      delivery_log.push(
        recordDelivery({
          correlation_id: input.correlation_id,
          route_key: effective.route_key,
          destination_type: effective.destination_type,
          status,
          payload: status === 'SUCCESS' ? payload : null,
          retry_count,
        }),
      )
    }
  }

  const success = delivery_log.some((d) => d.status === 'SUCCESS')
  if (input.incremental_cursor) {
    cp = advanceCheckpoint(cp, input.incremental_cursor, success)
  } else if (success) {
    cp = advanceCheckpoint(cp, String(input.events.length), success)
  }

  const collector = listCollector(input.correlation_id)
  const contract = assertDeliveryCollectorContract({
    delivery: delivery_log,
    collectorCount: collector.length,
    expectedNoDelivery: delivery_log.every((d) => d.status !== 'SUCCESS'),
  })
  const corr = assertCollectorCorrelation({ correlation_id: input.correlation_id, events: collector })

  return {
    auth_ok: true,
    auth_status: 200,
    delivery_log,
    collector,
    checkpoint_advanced: cp.advanced,
    checkpoint_cursor: cp.cursor,
    duplicate_skipped,
    blocked,
    quarantined,
    transform_errors,
    contract_errors: contract.errors,
    correlation_errors: corr.errors,
    route_payloads,
  }
}
