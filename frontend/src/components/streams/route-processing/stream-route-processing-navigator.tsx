import { Route } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { RouteRead } from '../../../api/gdcRoutes'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import {
  RouteProcessingDeliveryBadge,
  RouteProcessingStatusBadge,
} from './route-processing-status-badge'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'
import type { RouteProcessingStatus } from '../wizard/wizard-state'

type StreamRouteProcessingStatuses = {
  transform: RouteProcessingStatus | null
  protection: RouteProcessingStatus | null
  classification: RouteProcessingStatus | null
  policy: RouteProcessingStatus | null
}

function StreamRouteConcernStatus({
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

export function StreamRouteProcessingNavigator({
  routes,
  destinations,
  statusByRoute,
  statusesLoading,
  selectedRouteId,
  onSelect,
  loading,
}: {
  routes: RouteRead[]
  destinations: DestinationListItem[]
  statusByRoute: Record<number, StreamRouteProcessingStatuses>
  statusesLoading: boolean
  selectedRouteId: number | null
  onSelect: (routeId: number) => void
  loading: boolean
}) {
  const destinationById = new Map(destinations.map((d) => [d.id, d]))

  return (
    <nav className="space-y-3" aria-label="Route navigator" data-testid="route-processing-routes-section">
      <div>
        <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Routes ({routes.length})</h4>
        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
          Destination-specific processing units — select a route to review inherit/override status.
        </p>
      </div>

      {loading && routes.length === 0 ? (
        <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Loading routes…</p>
      ) : routes.length === 0 ? (
        <div
          className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2.5 text-[12px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100"
          data-testid="route-processing-empty"
        >
          <p className="font-semibold">{ROUTE_PROCESSING_COPY.noRoutes}</p>
          <p className="mt-0.5 text-[11px]">{ROUTE_PROCESSING_COPY.noRoutesHint}</p>
        </div>
      ) : (
        <div className="space-y-2.5" data-testid="route-processing-routes-table">
          {routes.map((route) => {
            const dest = route.destination_id != null ? destinationById.get(route.destination_id) : undefined
            const destLabel = dest?.name?.trim() || (route.destination_id != null ? `Destination #${route.destination_id}` : null)
            const destinationMissing = route.destination_id == null || !dest
            const statuses = statusByRoute[route.id]
            const statusPending = statusesLoading && statuses === undefined
            const isSelected = route.id === selectedRouteId
            const routeLabel = route.name?.trim() || `Route #${route.id}`

            return (
              <button
                key={route.id}
                type="button"
                onClick={() => onSelect(route.id)}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  isSelected
                    ? 'border-violet-500 bg-violet-500/[0.12] shadow-md ring-2 ring-violet-500/30 dark:border-violet-400 dark:bg-violet-500/15 dark:ring-violet-400/25'
                    : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
                )}
                data-testid={`route-processing-row-${route.id}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      isSelected
                        ? 'bg-violet-600 text-white dark:bg-violet-500'
                        : 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
                    )}
                  >
                    <Route className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</p>
                      {isSelected ? (
                        <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white dark:bg-violet-500">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    {destinationMissing ? (
                      <p className="mt-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                        {ROUTE_PROCESSING_COPY.destinationMissing}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
                        Destination: <span className="font-medium text-slate-700 dark:text-slate-200">{destLabel}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-gdc-border">
                  <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="route-card-row-transform">
                    <span className="font-medium text-slate-600 dark:text-gdc-muted">Transform</span>
                    <StreamRouteConcernStatus status={statuses?.transform} pending={statusPending} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="route-card-row-protection">
                    <span className="font-medium text-slate-600 dark:text-gdc-muted">Protection</span>
                    <StreamRouteConcernStatus status={statuses?.protection} pending={statusPending} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="route-card-row-classification">
                    <span className="font-medium text-slate-600 dark:text-gdc-muted">Classification</span>
                    <StreamRouteConcernStatus status={statuses?.classification} pending={statusPending} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="route-card-row-policy">
                    <span className="font-medium text-slate-600 dark:text-gdc-muted">Policy</span>
                    <StreamRouteConcernStatus status={statuses?.policy} pending={statusPending} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px]" data-testid="route-card-row-delivery">
                    <span className="font-medium text-slate-600 dark:text-gdc-muted">Delivery</span>
                    <RouteProcessingDeliveryBadge enabled={Boolean(route.enabled)} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </nav>
  )
}
