import {
  routeProtectionOverrideReviewRows,
  routeProtectionOverridesGroupedByField,
} from './wizard-route-protection-overrides-summary'
import type { WizardDataProtectionState, WizardRouteDraft } from './wizard-state'

export type RouteProtectionOverridesSummaryProps = {
  dataProtection: Pick<WizardDataProtectionState, 'routeOverrides'>
  routeDrafts: readonly WizardRouteDraft[]
  destinationLabelsByDraftKey?: ReadonlyMap<string, string>
}

/** Read-only per-route protection override summary for Deploy / Review. */
export function RouteProtectionOverridesSummary({
  dataProtection,
  routeDrafts,
  destinationLabelsByDraftKey = new Map(),
}: RouteProtectionOverridesSummaryProps) {
  const rows = routeProtectionOverrideReviewRows(
    dataProtection,
    routeDrafts,
    destinationLabelsByDraftKey,
  )
  const grouped = routeProtectionOverridesGroupedByField(rows)

  return (
    <div className="space-y-2" data-testid="route-protection-overrides-summary">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Protection Overrides</p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-600 dark:text-gdc-muted">No per-route protection overrides.</p>
      ) : (
        <div className="space-y-3">
          {[...grouped.entries()].map(([fieldPath, fieldRows]) => (
            <div key={fieldPath} data-testid={`route-override-field-${fieldPath}`}>
              <p className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">{fieldPath}</p>
              <ul className="mt-1 space-y-0.5 pl-3 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                {fieldRows.map((row) => (
                  <li key={`${row.fieldPath}-${row.routeLabel}`}>
                    {row.routeLabel} → {row.protectionAction}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
