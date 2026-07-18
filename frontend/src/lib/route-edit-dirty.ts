import type { RouteDeliveryMode, RouteFailurePolicy, RouteRetryBackoff } from '../components/routes/route-edit-defaults'

/** Editable delivery fields used for pristine/dirty comparison on Route Edit. */
export type RouteEditDeliverySnapshot = {
  routeName: string
  description: string
  enabled: boolean
  deliveryMode: RouteDeliveryMode
  failurePolicy: RouteFailurePolicy
  rateLimitEnabled: boolean
  perSecond: number
  burstSize: number
  maxRetry: number
  retryBackoff: RouteRetryBackoff
  initialBackoffSec: number
  maxBackoffSec: number
  maxDeliveryTimeSec: number
  batchSize: number
  destinationId: number | null
}

export function routeEditSnapshotsEqual(a: RouteEditDeliverySnapshot, b: RouteEditDeliverySnapshot): boolean {
  return (
    a.routeName === b.routeName &&
    a.description === b.description &&
    a.enabled === b.enabled &&
    a.deliveryMode === b.deliveryMode &&
    a.failurePolicy === b.failurePolicy &&
    a.rateLimitEnabled === b.rateLimitEnabled &&
    a.perSecond === b.perSecond &&
    a.burstSize === b.burstSize &&
    a.maxRetry === b.maxRetry &&
    a.retryBackoff === b.retryBackoff &&
    a.initialBackoffSec === b.initialBackoffSec &&
    a.maxBackoffSec === b.maxBackoffSec &&
    a.maxDeliveryTimeSec === b.maxDeliveryTimeSec &&
    a.batchSize === b.batchSize &&
    a.destinationId === b.destinationId
  )
}
