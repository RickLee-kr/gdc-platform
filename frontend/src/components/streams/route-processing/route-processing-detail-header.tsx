import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import type { RouteProcessingStatus } from '../wizard/wizard-state'
import {
  ROUTE_PROCESSING_CONCERN_KEYS,
  ROUTE_PROCESSING_CONCERN_LABEL,
  ROUTE_PROCESSING_COPY,
  routeProcessingStatusDisplayLabel,
} from './route-processing-labels'
import { RouteDeployReadinessBadge } from './route-processing-status-badge'

type RouteProcessingHeaderStatuses = {
  transform: RouteProcessingStatus | null
  protection: RouteProcessingStatus | null
  classification: RouteProcessingStatus | null
  policy: RouteProcessingStatus | null
}

function HeaderConcernStatus({
  concern,
  status,
  pending,
}: {
  concern: (typeof ROUTE_PROCESSING_CONCERN_KEYS)[number]
  status: RouteProcessingStatus | null | undefined
  pending: boolean
}) {
  const label = ROUTE_PROCESSING_CONCERN_LABEL[concern]
  if (pending) {
    return (
      <span className="text-[11px] text-slate-400 dark:text-gdc-muted" data-testid={`route-header-row-${concern}`}>
        {label}: …
      </span>
    )
  }
  if (status == null) {
    return (
      <span className="text-[11px] text-slate-500 dark:text-gdc-muted" data-testid={`route-header-row-${concern}`}>
        {label}: Unavailable
      </span>
    )
  }
  return (
    <span className="text-[11px] text-slate-600 dark:text-gdc-muted" data-testid={`route-header-row-${concern}`}>
      {label}:{' '}
      <span className="font-semibold text-slate-800 dark:text-slate-100">
        {routeProcessingStatusDisplayLabel(status)}
      </span>
    </span>
  )
}

export function RouteProcessingDetailHeader({
  routeLabel,
  destinationLabel,
  destinationMissing = false,
  processingStatuses,
  statusesPending = false,
  deployStatus,
  deployStatusLabel,
  actions,
  className,
}: {
  routeLabel: string
  destinationLabel?: string | null
  destinationMissing?: boolean
  processingStatuses?: RouteProcessingHeaderStatuses
  statusesPending?: boolean
  deployStatus?: 'ready' | 'warning' | 'error'
  deployStatusLabel?: string
  actions?: ReactNode
  className?: string
}) {
  const destDisplay = destinationLabel?.trim() || null

  return (
    <header
      className={cn('border-b border-slate-100 px-3 py-3 dark:border-gdc-border', className)}
      data-testid="route-processing-detail-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
            Route Workspace
          </p>
          <h4 className="mt-0.5 truncate text-[15px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</h4>
          {destinationMissing ? (
            <div className="mt-1 space-y-0.5" data-testid="route-destination-missing-warning">
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                {ROUTE_PROCESSING_COPY.destinationMissing}
              </p>
              <p className="text-[10px] text-red-600/90 dark:text-red-300/90">
                {ROUTE_PROCESSING_COPY.destinationMissingHint}
              </p>
            </div>
          ) : destDisplay ? (
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted" data-testid="route-detail-destination">
              Destination: <span className="font-medium text-slate-800 dark:text-slate-100">{destDisplay}</span>
            </p>
          ) : null}
          {deployStatus || deployStatusLabel ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {deployStatusLabel ? (
                <p className="text-[11px] text-slate-600 dark:text-gdc-muted" data-testid="route-header-status">
                  Status:{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{deployStatusLabel}</span>
                </p>
              ) : null}
              {deployStatus ? (
                <RouteDeployReadinessBadge status={deployStatus} data-testid="route-header-deploy-status" />
              ) : null}
            </div>
          ) : null}
          {processingStatuses ? (
            <div
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 dark:border-gdc-border"
              data-testid="route-header-processing-statuses"
            >
              {ROUTE_PROCESSING_CONCERN_KEYS.map((concern) => (
                <HeaderConcernStatus
                  key={concern}
                  concern={concern}
                  status={processingStatuses[concern]}
                  pending={statusesPending}
                />
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  )
}
