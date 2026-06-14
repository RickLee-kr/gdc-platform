import { AlertTriangle } from 'lucide-react'
import {
  schemaDriftPolicyPhase1Warnings,
  schemaDriftPolicyReviewSummary,
} from './wizard-data-protection-summary'
import type { WizardDataProtectionState } from './wizard-state'

export type SchemaDriftPolicySummaryProps = {
  dataProtection: Pick<WizardDataProtectionState, 'unknownNormalFieldPolicy' | 'unknownSensitiveFieldPolicy'>
}

/** Read-only Schema Drift Policy summary for Review / Deploy screens. */
export function SchemaDriftPolicySummary({ dataProtection }: SchemaDriftPolicySummaryProps) {
  const summary = schemaDriftPolicyReviewSummary(dataProtection)
  const phase1Warnings = schemaDriftPolicyPhase1Warnings(dataProtection)

  return (
    <div className="space-y-2" data-testid="schema-drift-policy-summary">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Schema Drift Policy</p>
      {phase1Warnings.length > 0 ? (
        <div
          className="flex gap-2 rounded-md border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
          data-testid="schema-drift-auto-protect-phase1-warning"
          role="note"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {phase1Warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
