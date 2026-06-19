import { Route } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import {
  computeWizardRouteProcessingStatuses,
  type WizardDataProtectionState,
  type WizardRouteDraft,
} from '../wizard/wizard-state'
import { RouteProcessingStatusLabel } from './route-processing-status-badge'

function RouteProcessingConcernRow({
  label,
  status,
}: {
  label: string
  status: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]" data-testid={`route-card-row-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span className="font-medium text-slate-600 dark:text-gdc-muted">{label}</span>
      {label === 'Delivery' ? (
        <span
          className={cn(
            'font-semibold',
            status === 'Enabled' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-gdc-muted',
          )}
          data-testid="route-card-delivery-status"
        >
          {status}
        </span>
      ) : (
        <RouteProcessingStatusLabel status={status as 'Inherited' | 'Overridden' | 'Mixed'} />
      )}
    </div>
  )
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
        <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100">
          No routes configured. Go back to Destinations to add delivery paths.
        </p>
      ) : (
        <div className="space-y-3">
          {routeDrafts.map((draft) => {
            const dest = destById.get(draft.destinationId)
            const destLabel = dest?.name?.trim() || `Destination #${draft.destinationId}`
            const statuses = computeWizardRouteProcessingStatuses(draft, dataProtection)
            const selected = draft.key === selectedKey
            return (
              <button
                key={draft.key}
                type="button"
                onClick={() => onSelect(draft.key)}
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  selected
                    ? 'border-violet-400/80 bg-violet-500/[0.06] shadow-sm dark:border-violet-500/50 dark:bg-violet-500/10'
                    : 'border-slate-200/90 bg-white hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
                )}
                data-testid={`route-processing-list-card-${draft.key}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                    <Route className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-900 dark:text-slate-50">{destLabel}</p>
                    <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Destination-specific processing</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-gdc-border">
                  <RouteProcessingConcernRow label="Transform" status={statuses.transform} />
                  <RouteProcessingConcernRow label="Protection" status={statuses.protection} />
                  <RouteProcessingConcernRow label="Classification" status={statuses.classification} />
                  <RouteProcessingConcernRow label="Policy" status={statuses.policy} />
                  <RouteProcessingConcernRow label="Delivery" status={draft.enabled ? 'Enabled' : 'Disabled'} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
