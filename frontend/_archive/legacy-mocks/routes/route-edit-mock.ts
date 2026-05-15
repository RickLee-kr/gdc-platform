import { MOCK_ROUTE_ROWS } from './routes-mock-data'

export type RouteEditMock = {
  routeId: string
  routeName: string
  connector: string
  stream: string
  destination: string
  status: 'ENABLED' | 'DISABLED'
  deliveryMode: 'Reliable' | 'Best Effort'
  lastUpdated: string
  updatedBy: string
  description: string
  failurePolicy: 'Retry' | 'Log and Continue' | 'Pause Stream' | 'Disable Route'
  maxRetry: number
  retryBackoff: 'Exponential' | 'Linear'
  initialBackoffSec: number
  maxBackoffSec: number
  maxDeliveryTimeSec: number
  batchSize: number
  rateLimitEnabled: boolean
  perSecond: number
  burstSize: number
  enrichmentProfile: string
  filterJsonPath: string
}

export function getRouteEditMock(routeId: string): RouteEditMock {
  const row = MOCK_ROUTE_ROWS.find((r) => r.id === routeId)
  const isEnabled = row?.status !== 'DISABLED'
  return {
    routeId: row?.id ?? routeId,
    routeName: row?.routeLabel ?? 'Malop -> Stellar SIEM (UDP)',
    connector: row?.connectorName ?? 'Cybereason EDR Platform',
    stream: row?.streamName ?? 'Malop API Stream',
    destination: row?.destinationLabel ?? 'Stellar SIEM Syslog UDP',
    status: isEnabled ? 'ENABLED' : 'DISABLED',
    deliveryMode: 'Reliable',
    lastUpdated: '2026-05-08 11:30:22',
    updatedBy: 'operator',
    description: 'Deliver Malop events to Stellar SIEM via Syslog UDP',
    failurePolicy: 'Retry',
    maxRetry: 5,
    retryBackoff: 'Exponential',
    initialBackoffSec: 1,
    maxBackoffSec: 60,
    maxDeliveryTimeSec: 0,
    batchSize: 100,
    rateLimitEnabled: true,
    perSecond: 100,
    burstSize: 200,
    enrichmentProfile: 'Cybereason Default Enrichment',
    filterJsonPath: '$.severity in ["high", "critical"]',
  }
}
