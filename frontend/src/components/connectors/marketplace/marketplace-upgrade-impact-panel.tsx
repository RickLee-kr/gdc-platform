import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import type { UpgradeImpactPreviewResponse } from '../../../api/gdcMarketplace'
import { cn } from '../../../lib/utils'

export type MarketplaceUpgradeImpactPanelProps = {
  preview: UpgradeImpactPreviewResponse | null
  loading?: boolean
  error?: string | null
  className?: string
}

export function MarketplaceUpgradeImpactPanel({
  preview,
  loading = false,
  error = null,
  className,
}: MarketplaceUpgradeImpactPanelProps) {
  return (
    <section
      aria-label="Update impact preview"
      data-testid="marketplace-upgrade-impact-panel"
      className={cn(
        'rounded-lg border border-slate-200/90 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-card/50',
        className,
      )}
    >
      <div>
        <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Update impact preview</p>
        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
          Preview only — catalog upgrade does not mutate running Stream config, checkpoints, or schema baselines.
        </p>
      </div>

      {loading ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Analyzing package impact…
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] font-medium text-red-700 dark:text-red-300" data-testid="marketplace-upgrade-impact-error">
          {error}
        </p>
      ) : null}

      {!loading && preview != null ? (
        <div className="mt-3 space-y-3" data-testid="marketplace-upgrade-impact-body">
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]',
              preview.can_upgrade
                ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                : 'border-red-200/80 bg-red-50/70 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
            )}
            data-testid="marketplace-upgrade-apply-status"
          >
            {preview.can_upgrade ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <div>
              <p className="font-semibold">{preview.can_upgrade ? 'Safe to upgrade' : 'Upgrade blocked'}</p>
              <p className="mt-0.5 opacity-90">
                {preview.current_pack_version} → {preview.proposed_pack_version}
              </p>
            </div>
          </div>

          <div data-testid="marketplace-upgrade-test">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Test</p>
            <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">
              <span className="font-semibold">{preview.test.status}</span>
              {preview.test.summary ? ` · ${preview.test.summary}` : ''}
            </p>
          </div>

          {preview.has_changes ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Changes
              </p>
              <ul className="mt-1 space-y-1" data-testid="marketplace-upgrade-changed-fields">
                {preview.changed_fields.slice(0, 8).map((change) => (
                  <li key={`${change.path}:${change.change}`} className="text-[11px] text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{change.path}</span>
                    <span className="text-slate-400"> · {change.change}</span>
                  </li>
                ))}
                {preview.changed_fields.length > 8 ? (
                  <li className="text-[10px] text-slate-400">+{preview.changed_fields.length - 8} more</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Impact</p>
            <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200" data-testid="marketplace-upgrade-affected">
              {preview.affected.streams.length} stream(s) · {preview.affected.routes.length} route(s) ·{' '}
              {preview.affected.destinations.length} destination(s)
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{preview.delivery_impact}</p>
          </div>

          {preview.blocking_issues.length > 0 ? (
            <div data-testid="marketplace-upgrade-blocking">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">Blocking</p>
              <ul className="mt-1 space-y-1">
                {preview.blocking_issues.map((issue) => (
                  <li key={issue.code} className="flex items-start gap-1.5 text-[11px] text-red-800 dark:text-red-200">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div data-testid="marketplace-upgrade-warnings">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Warnings
              </p>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((issue) => (
                  <li key={issue.code} className="flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
