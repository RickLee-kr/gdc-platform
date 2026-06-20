import type { RouteProcessingStatus } from '../wizard/wizard-state'
import { ROUTE_PROCESSING_CARD_CONCERN_LABEL, type RouteProcessingDeployMode } from './route-processing-labels'
import {
  RouteProcessingDeliveryBadge,
  RouteProcessingDeployModeBadge,
  RouteProcessingStatusBadge,
} from './route-processing-status-badge'

export function RouteProcessingConcernRow({
  concern,
  status,
}: {
  concern: keyof typeof ROUTE_PROCESSING_CARD_CONCERN_LABEL
  status: RouteProcessingStatus | RouteProcessingDeployMode | 'Enabled' | 'Disabled'
}) {
  const label = ROUTE_PROCESSING_CARD_CONCERN_LABEL[concern]
  const testId = `route-card-row-${concern}`

  return (
    <div className="flex items-center justify-between gap-3 text-[11px]" data-testid={testId}>
      <span className="font-medium text-slate-600 dark:text-gdc-muted">{label}</span>
      {concern === 'delivery' ? (
        <RouteProcessingDeliveryBadge enabled={status === 'Enabled'} />
      ) : status === 'shared' || status === 'override' ? (
        <RouteProcessingDeployModeBadge mode={status} />
      ) : (
        <RouteProcessingStatusBadge status={status as RouteProcessingStatus} />
      )}
    </div>
  )
}
