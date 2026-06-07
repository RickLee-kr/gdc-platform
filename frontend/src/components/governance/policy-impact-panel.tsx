import { Loader2 } from 'lucide-react'
import type { GovernancePolicyImpactResponse } from '../../api/gdcGovernancePolicies'
import { cn } from '../../lib/utils'

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ')
}

export type PolicyImpactPanelProps = {
  impact: GovernancePolicyImpactResponse | null
  loading?: boolean
  className?: string
}

export function PolicyImpactPanel({ impact, loading = false, className }: PolicyImpactPanelProps) {
  return (
    <section
      className={cn(
        'rounded-lg border border-slate-200/90 bg-slate-50/50 p-3 dark:border-gdc-border dark:bg-gdc-card/50',
        className,
      )}
      aria-label="Policy impact"
      data-testid="policy-impact-panel"
    >
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Impact Analysis</p>
      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
        Preview only — runtime enforcement not enabled.
      </p>

      {loading ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Analyzing last 24 hours…
        </p>
      ) : impact == null ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted">Adjust rules to analyze impact.</p>
      ) : !impact.data_available ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="policy-impact-empty">
          Not enough runtime data yet
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-slate-200/80 bg-white px-2.5 py-2 dark:border-gdc-border dark:bg-gdc-card">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Total Events
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-slate-900 dark:text-slate-100">
                {formatCount(impact.total_events)}
              </p>
              <p className="text-[10px] text-slate-400">Last {impact.window}</p>
            </div>
            <div className="rounded-md border border-violet-200/80 bg-violet-50/60 px-2.5 py-2 dark:border-violet-500/30 dark:bg-violet-500/10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                Matched Events
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-violet-900 dark:text-violet-100">
                {formatCount(impact.matched_events)}
              </p>
              {impact.delta.matched_events_change != null ? (
                <p
                  className={cn(
                    'text-[10px] font-medium',
                    impact.delta.matched_events_change > 0
                      ? 'text-amber-700 dark:text-amber-300'
                      : impact.delta.matched_events_change < 0
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-400',
                  )}
                  data-testid="policy-impact-delta"
                >
                  {impact.delta.matched_events_change > 0 ? '+' : ''}
                  {formatCount(impact.delta.matched_events_change)} vs saved policy
                </p>
              ) : (
                <p className="text-[10px] text-slate-400">Estimated matches</p>
              )}
            </div>
          </div>

          {Object.keys(impact.actions).length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Action Breakdown</p>
              <ul className="mt-1 space-y-1">
                {Object.entries(impact.actions).map(([action, count]) => (
                  <li
                    key={action}
                    className="flex items-center justify-between rounded-md bg-white/80 px-2 py-1 text-[11px] dark:bg-gdc-card/80"
                  >
                    <span className="capitalize text-slate-700 dark:text-slate-200">{actionLabel(action)}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCount(count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {impact.streams.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Stream Breakdown</p>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-slate-500 dark:text-gdc-muted">
                      <th className="pb-1 pr-2 font-semibold">Stream</th>
                      <th className="pb-1 pr-2 font-semibold">Total</th>
                      <th className="pb-1 font-semibold">Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.streams.map((row) => (
                      <tr key={row.stream_id} className="border-t border-slate-100 dark:border-gdc-border/60">
                        <td className="py-1 pr-2 text-slate-800 dark:text-slate-200">{row.stream_name}</td>
                        <td className="py-1 pr-2">{formatCount(row.total_events)}</td>
                        <td className="py-1 font-semibold">{formatCount(row.matched_events)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
