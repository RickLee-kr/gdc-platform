import { Route } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import {
  computeWizardRouteProcessingStatuses,
  type WizardDataProtectionState,
  type WizardRouteDraft,
} from '../wizard/wizard-state'
import { RouteProcessingConcernRow } from './route-processing-concern-row'
import { ROUTE_PROCESSING_COPY } from './route-processing-labels'

function routeHasDestination(draft: WizardRouteDraft): boolean {
  return draft.destinationId > 0
}

export function WizardRouteProcessingList({
  routeDrafts,
  destinations,
  dataProtection,
  selectedKey,
  onSelect,
}: {
  routeDrafts: readonly WizardRouteDraft[]
  destinations: readonly DestinationListItem[]
  dataProtection: WizardDataProtectionState
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const destById = new Map(destinations.map((d) => [d.id, d]))

  return (
    <section className="space-y-3" data-testid="route-processing-list">
      <div>
        <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Route Processing</h4>
        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
          Each route is a destination-specific processing unit — Transform, Protection, Classification, Policy, and
          Delivery per destination.
        </p>
      </div>

      {routeDrafts.length === 0 ? (
        <div
          className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2.5 text-[12px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100"
          data-testid="route-processing-empty"
        >
          <p className="font-semibold">{ROUTE_PROCESSING_COPY.noRoutes}</p>
          <p className="mt-0.5 text-[11px]">{ROUTE_PROCESSING_COPY.noRoutesHint}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {routeDrafts.map((draft) => {
            const dest = destById.get(draft.destinationId)
            const hasDestination = routeHasDestination(draft) && Boolean(dest)
            const routeLabel = dest?.name?.trim() || `Destination #${draft.destinationId}`
            const statuses = computeWizardRouteProcessingStatuses(draft, dataProtection)
            const selected = draft.key === selectedKey
            const hasOverrides = [statuses.transform, statuses.protection, statuses.classification, statuses.policy].some(
              (s) => s !== 'Inherited',
            )

            return (
              <button
                key={draft.key}
                type="button"
                onClick={() => onSelect(draft.key)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  selected
                    ? 'border-violet-500 bg-violet-500/[0.08] shadow-md ring-2 ring-violet-500/25 dark:border-violet-400 dark:bg-violet-500/12 dark:ring-violet-400/20'
                    : 'border-slate-200/90 bg-white hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
                )}
                data-testid={`route-processing-list-card-${draft.key}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      selected
                        ? 'bg-violet-600 text-white dark:bg-violet-500'
                        : 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
                    )}
                  >
                    <Route className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-slate-900 dark:text-slate-50">{routeLabel}</p>
                      {selected ? (
                        <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white dark:bg-violet-500">
                          Active
                        </span>
                      ) : null}
                    </div>
                    {!hasDestination ? (
                      <p className="mt-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                        {ROUTE_PROCESSING_COPY.destinationMissing}
                      </p>
                    ) : !hasOverrides ? (
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
                        {ROUTE_PROCESSING_COPY.allInherited}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">Destination-specific processing</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-gdc-border">
                  <RouteProcessingConcernRow concern="transform" status={statuses.transform} />
                  <RouteProcessingConcernRow concern="protection" status={statuses.protection} />
                  <RouteProcessingConcernRow concern="classification" status={statuses.classification} />
                  <RouteProcessingConcernRow concern="policy" status={statuses.policy} />
                  <RouteProcessingConcernRow concern="delivery" status={draft.enabled ? 'Enabled' : 'Disabled'} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
