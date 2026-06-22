import { Route } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import type { RouteRead } from '../../../api/gdcRoutes'
import {
  computeWizardRouteProcessingStatuses,
  type RouteProcessingStatus,
  type WizardDataProtectionState,
  type WizardRouteDraft,
} from '../wizard/wizard-state'
import { RouteProcessingConcernRow } from './route-processing-concern-row'
import {
  RouteProcessingDeliveryBadge,
  RouteProcessingStatusBadge,
  RouteDeployReadinessBadge,
} from './route-processing-status-badge'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'

type StreamProcessingStatuses = {
  transform: RouteProcessingStatus | null
  protection: RouteProcessingStatus | null
  classification: RouteProcessingStatus | null
  policy: RouteProcessingStatus | null
}

export type RouteProcessingSelectedRouteSummaryProps =
  | {
      variant: 'wizard'
      draft: WizardRouteDraft
      destination: DestinationListItem | undefined
      dataProtection: WizardDataProtectionState
      deployStatus?: 'ready' | 'warning' | 'error'
      deployStatusLabel?: string
    }
  | {
      variant: 'stream'
      route: RouteRead
      destinationLabel: string | null
      destinationMissing: boolean
      processingStatuses: StreamProcessingStatuses | undefined
      statusesPending: boolean
      enabled: boolean
    }

function StreamConcernStatus({
  status,
  pending,
}: {
  status: RouteProcessingStatus | null | undefined
  pending: boolean
}) {
  if (pending) {
    return <span className="text-[10px] text-slate-400 dark:text-gdc-muted">…</span>
  }
  if (status == null) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-slate-200/90 bg-slate-100/80 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted"
        data-testid="route-processing-status-unavailable"
      >
        Unavailable
      </span>
    )
  }
  return <RouteProcessingStatusBadge status={status} />
}

export function RouteProcessingSelectedRouteSummary(props: RouteProcessingSelectedRouteSummaryProps) {
  if (props.variant === 'wizard') {
    const { draft, destination, dataProtection, deployStatus, deployStatusLabel } = props
    const routeLabel = destination?.name?.trim() || `Destination #${draft.destinationId}`
    const destinationMissing = !draft.destinationId || draft.destinationId <= 0 || !destination
    const statuses = computeWizardRouteProcessingStatuses(draft, dataProtection)

    return (
      <article
        className="rounded-lg border border-violet-300/60 bg-violet-500/[0.04] p-3 shadow-sm dark:border-violet-500/35 dark:bg-violet-500/10"
        data-testid="route-processing-selected-summary"
      >
        <div className="flex items-start gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white dark:bg-violet-500">
            <Route className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                Selected
              </p>
              {deployStatus ? (
                <RouteDeployReadinessBadge status={deployStatus} data-testid="selected-route-deploy-status" />
              ) : null}
            </div>
            <h4 className="mt-0.5 truncate text-[14px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</h4>
            {destinationMissing ? (
              <p className="mt-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                {ROUTE_PROCESSING_COPY.destinationMissing}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted" data-testid="selected-route-destination">
                Destination: <span className="font-medium text-slate-800 dark:text-slate-100">{destination?.name}</span>
              </p>
            )}
            {deployStatusLabel ? (
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">Status: {deployStatusLabel}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          <RouteProcessingConcernRow concern="transform" status={statuses.transform} />
          <RouteProcessingConcernRow concern="protection" status={statuses.protection} />
          <RouteProcessingConcernRow concern="classification" status={statuses.classification} />
          <RouteProcessingConcernRow concern="policy" status={statuses.policy} />
          <RouteProcessingConcernRow concern="delivery" status={draft.enabled ? 'Enabled' : 'Disabled'} />
        </div>
      </article>
    )
  }

  const { route, destinationLabel, destinationMissing, processingStatuses, statusesPending, enabled } = props
  const routeLabel = route.name?.trim() || `Route #${route.id}`

  return (
    <article
      className="rounded-lg border border-violet-300/60 bg-violet-500/[0.04] p-3 shadow-sm dark:border-violet-500/35 dark:bg-violet-500/10"
      data-testid="route-processing-selected-summary"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white dark:bg-violet-500">
          <Route className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Selected</p>
          <h4 className="mt-0.5 truncate text-[14px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</h4>
          {destinationMissing ? (
            <p className="mt-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
              {ROUTE_PROCESSING_COPY.destinationMissing}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted" data-testid="selected-route-destination">
              Destination: <span className="font-medium text-slate-800 dark:text-slate-100">{destinationLabel}</span>
            </p>
          )}
          <div className="mt-1">
            <RouteProcessingDeliveryBadge enabled={enabled} />
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(['transform', 'protection', 'classification', 'policy'] as const).map((concern) => (
          <div key={concern} className="flex items-center justify-between gap-3 text-[11px]" data-testid={`selected-route-row-${concern}`}>
            <span className="font-medium capitalize text-slate-600 dark:text-gdc-muted">{concern}</span>
            <StreamConcernStatus status={processingStatuses?.[concern]} pending={statusesPending} />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="selected-route-row-delivery">
          <span className="font-medium text-slate-600 dark:text-gdc-muted">Delivery</span>
          <RouteProcessingDeliveryBadge enabled={enabled} />
        </div>
      </div>
    </article>
  )
}

export function RouteProcessingSelectedRouteSummaryEmpty({ className }: { className?: string }) {
  return (
    <article
      className={cn(
        'flex min-h-[8rem] items-center justify-center rounded-lg border border-dashed border-slate-200/90 p-4 text-center dark:border-gdc-border',
        className,
      )}
      data-testid="route-processing-selected-summary-empty"
    >
      <p className="text-[12px] text-slate-500 dark:text-gdc-muted">{ROUTE_PROCESSING_COPY.selectRouteConfigure}</p>
    </article>
  )
}
