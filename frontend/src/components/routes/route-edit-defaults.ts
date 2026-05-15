export type RouteFailurePolicy = 'Retry' | 'Log and Continue' | 'Pause Stream' | 'Disable Route'
export type RouteDeliveryMode = 'Reliable' | 'Best Effort'
export type RouteRetryBackoff = 'Exponential' | 'Linear'

export const ROUTE_EDIT_DEFAULTS = {
  routeName: 'New Route',
  description: '',
  status: 'ENABLED' as const,
  deliveryMode: 'Reliable' as RouteDeliveryMode,
  failurePolicy: 'Retry' as RouteFailurePolicy,
  maxRetry: 5,
  retryBackoff: 'Exponential' as RouteRetryBackoff,
  initialBackoffSec: 1,
  maxBackoffSec: 60,
  maxDeliveryTimeSec: 0,
  batchSize: 100,
  rateLimitEnabled: true,
  perSecond: 100,
  burstSize: 200,
  enrichmentProfile: '',
  filterJsonPath: '',
}
