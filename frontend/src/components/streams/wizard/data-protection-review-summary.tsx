import { ProtectionRulesSummary } from './protection-rules-summary'
import { RouteProtectionOverridesSummary } from './route-protection-overrides-summary'
import { SchemaDriftPolicySummary } from './schema-drift-policy-summary'
import type { WizardDataProtectionState, WizardRouteDraft } from './wizard-state'

export type DataProtectionReviewSummaryProps = {
  dataProtection: WizardDataProtectionState
  routeDrafts?: readonly WizardRouteDraft[]
  destinationLabelsByDraftKey?: ReadonlyMap<string, string>
}

/** Combined Data Protection review block: Schema Drift Policy → Protection Rules → Overrides. */
export function DataProtectionReviewSummary({
  dataProtection,
  routeDrafts = [],
  destinationLabelsByDraftKey,
}: DataProtectionReviewSummaryProps) {
  return (
    <div className="space-y-4" data-testid="data-protection-review-summary">
      <SchemaDriftPolicySummary dataProtection={dataProtection} />
      <div className="border-t border-slate-200/80 dark:border-gdc-border" role="separator" />
      <ProtectionRulesSummary dataProtection={dataProtection} />
      {dataProtection.routeOverrides.some((o) => o.enabled) ? (
        <>
          <div className="border-t border-slate-200/80 dark:border-gdc-border" role="separator" />
          <RouteProtectionOverridesSummary
            dataProtection={dataProtection}
            routeDrafts={routeDrafts}
            destinationLabelsByDraftKey={destinationLabelsByDraftKey}
          />
        </>
      ) : null}
    </div>
  )
}
