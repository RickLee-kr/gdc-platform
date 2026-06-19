import { cn } from '../../../lib/utils'
import type { DestinationListItem } from '../../../api/gdcDestinations'
import {
  computeWizardRouteProcessingStatuses,
  type WizardDataProtectionState,
  type WizardRouteDraft,
} from '../wizard/wizard-state'
import { RouteProcessingStatusRow } from './route-processing-status-badge'

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
        <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">2 Routes</h4>
        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
          Select a route to review processing inheritance and overrides.
        </p>
      </div>

      {routeDrafts.length === 0 ? (
        <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100">
          No routes configured. Go back to Destinations to add delivery paths.
        </p>
      ) : (
        <div className="space-y-2">
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
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-violet-400/80 bg-violet-500/[0.06] dark:border-violet-500/50 dark:bg-violet-500/10'
                    : 'border-slate-200/90 bg-white hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
                )}
                data-testid={`route-processing-list-card-${draft.key}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">{destLabel}</p>
                    <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
                      {draft.enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <RouteProcessingStatusRow label="Transform" status={statuses.transform} />
                  <RouteProcessingStatusRow label="Protection" status={statuses.protection} />
                  <RouteProcessingStatusRow label="Classification" status={statuses.classification} />
                  <RouteProcessingStatusRow label="Policy" status={statuses.policy} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
