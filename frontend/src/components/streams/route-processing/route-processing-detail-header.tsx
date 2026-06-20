import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'

export function RouteProcessingDetailHeader({
  routeLabel,
  destinationLabel,
  destinationMissing = false,
  actions,
  className,
}: {
  routeLabel: string
  destinationLabel?: string | null
  destinationMissing?: boolean
  actions?: ReactNode
  className?: string
}) {
  const destDisplay = destinationLabel?.trim() || null

  return (
    <header
      className={cn('border-b border-slate-100 px-3 py-2.5 dark:border-gdc-border', className)}
      data-testid="route-processing-detail-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
            {ROUTE_PROCESSING_COPY.routeDetailTitle}
          </p>
          <h4 className="mt-0.5 truncate text-[14px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</h4>
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
          <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-muted">
            Processing: Transform / Protection / Classification / Policy / Delivery
          </p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  )
}
