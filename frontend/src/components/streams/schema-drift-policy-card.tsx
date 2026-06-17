import type { StreamSchemaDriftPolicyLabels } from '../../lib/stream-schema-drift-policy'

export type SchemaDriftPolicyCardProps = {
  policy: StreamSchemaDriftPolicyLabels
}

/** Read-only deployed Schema Drift Policy summary for Stream Runtime governance. */
export function SchemaDriftPolicyCard({ policy }: SchemaDriftPolicyCardProps) {
  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Schema Drift Policy"
      data-testid="schema-drift-policy-runtime-card"
    >
      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Schema Drift Policy</p>
      <dl className="mt-2 space-y-2 text-[12px]">
        <div className="grid gap-0.5">
          <dt className="text-[11px] font-medium text-slate-500 dark:text-gdc-muted">Unknown Normal Field</dt>
          <dd className="text-slate-800 dark:text-slate-200">{policy.unknownNormalField}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[11px] font-medium text-slate-500 dark:text-gdc-muted">Unknown Sensitive Field</dt>
          <dd className="text-slate-800 dark:text-slate-200">{policy.unknownSensitiveField}</dd>
        </div>
      </dl>
    </section>
  )
}
