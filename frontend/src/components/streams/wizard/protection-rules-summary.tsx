import { protectionRulesReviewRows } from './wizard-data-protection-summary'
import type { WizardDataProtectionState } from './wizard-state'

export type ProtectionRulesSummaryProps = {
  dataProtection: Pick<WizardDataProtectionState, 'intents'>
}

/** Read-only Protection Rules summary for Review / Deploy screens. */
export function ProtectionRulesSummary({ dataProtection }: ProtectionRulesSummaryProps) {
  const rows = protectionRulesReviewRows(dataProtection.intents)

  return (
    <div className="space-y-2" data-testid="protection-rules-summary">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Protection Rules</p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-600 dark:text-gdc-muted">No protection rules configured.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-gdc-border">
          <table className="w-full min-w-[420px] border-collapse text-left text-[11px]">
            <thead className="border-b border-slate-200/80 bg-slate-50/90 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted">
              <tr>
                <th className="px-2.5 py-2">Detected Fields</th>
                <th className="px-2.5 py-2">Protection Action</th>
                <th className="px-2.5 py-2">Delivery Behavior</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.detectedField} className="border-t border-slate-100 dark:border-gdc-border">
                  <td className="px-2.5 py-2 font-mono text-[10px] text-slate-800 dark:text-slate-200">{row.detectedField}</td>
                  <td className="px-2.5 py-2 text-slate-700 dark:text-slate-200">{row.protectionAction}</td>
                  <td className="px-2.5 py-2 text-slate-700 dark:text-slate-200">{row.deliveryBehavior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
