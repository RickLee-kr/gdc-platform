import { ProtectionRulesSummary } from './protection-rules-summary'
import { SchemaDriftPolicySummary } from './schema-drift-policy-summary'
import type { WizardDataProtectionState } from './wizard-state'

export type DataProtectionReviewSummaryProps = {
  dataProtection: WizardDataProtectionState
}

/** Combined Data Protection review block: Schema Drift Policy → Protection Rules. */
export function DataProtectionReviewSummary({ dataProtection }: DataProtectionReviewSummaryProps) {
  return (
    <div className="space-y-4" data-testid="data-protection-review-summary">
      <SchemaDriftPolicySummary dataProtection={dataProtection} />
      <div className="border-t border-slate-200/80 dark:border-gdc-border" role="separator" />
      <ProtectionRulesSummary dataProtection={dataProtection} />
    </div>
  )
}
