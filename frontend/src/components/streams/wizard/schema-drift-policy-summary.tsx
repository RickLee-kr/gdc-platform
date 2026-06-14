import type { WizardDataProtectionState } from './wizard-state'
import { schemaDriftPolicyReviewSummary } from './wizard-data-protection-summary'

export type SchemaDriftPolicySummaryProps = {
  dataProtection: Pick<WizardDataProtectionState, 'unknownNormalFieldPolicy' | 'unknownSensitiveFieldPolicy'>
}

/** Read-only Schema Drift Policy summary for Review / Deploy screens. */
export function SchemaDriftPolicySummary({ dataProtection }: SchemaDriftPolicySummaryProps) {
  const summary = schemaDriftPolicyReviewSummary(dataProtection)

  return (
    <div className="space-y-2" data-testid="schema-drift-policy-summary">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Schema Drift Policy</p>
      <dl className="space-y-2 text-[12px]">
        <div className="grid gap-0.5">
          <dt className="text-[11px] font-medium text-slate-500">Unknown Normal Field</dt>
          <dd className="text-slate-800 dark:text-slate-200">{summary.unknownNormalField}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[11px] font-medium text-slate-500">Unknown Sensitive Field</dt>
          <dd className="text-slate-800 dark:text-slate-200">{summary.unknownSensitiveField}</dd>
        </div>
      </dl>
    </div>
  )
}
