import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import type { SafeChangePreviewResponse } from '../../api/gdcSafeChange'
import { cn } from '../../lib/utils'

export type SafeChangeImpactPanelProps = {
  preview: SafeChangePreviewResponse | null
  loading?: boolean
  error?: string | null
  className?: string
  onPreview?: () => void
}

export function SafeChangeImpactPanel({
  preview,
  loading = false,
  error = null,
  className,
  onPreview,
}: SafeChangeImpactPanelProps) {
  return (
    <section
      aria-label="Safe change impact"
      data-testid="safe-change-impact-panel"
      className={cn(
        'rounded-lg border border-slate-200/90 bg-slate-50/60 p-3 dark:border-gdc-border dark:bg-gdc-card/50',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Change impact</p>
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
            Preview only — nothing is applied until you save.
          </p>
        </div>
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            disabled={loading}
            className="inline-flex h-7 items-center rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
            data-testid="safe-change-preview-button"
          >
            {loading ? 'Checking…' : 'Preview impact'}
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Analyzing impact…
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] font-medium text-red-700 dark:text-red-300" data-testid="safe-change-error">
          {error}
        </p>
      ) : null}

      {!loading && !error && preview == null ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted">
          Review impact before applying high-impact configuration changes.
        </p>
      ) : null}

      {!loading && preview != null ? (
        <div className="mt-3 space-y-3" data-testid="safe-change-preview-body">
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]',
              preview.can_apply
                ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                : 'border-red-200/80 bg-red-50/70 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
            )}
            data-testid="safe-change-apply-status"
          >
            {preview.can_apply ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <div>
              <p className="font-semibold">{preview.can_apply ? 'Safe to apply' : 'Apply blocked'}</p>
              <p className="mt-0.5 opacity-90">
                {preview.has_changes ? preview.runtime_impact : 'No configuration differences detected.'}
              </p>
            </div>
          </div>

          {preview.has_changes ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                What changes
              </p>
              <ul className="mt-1 space-y-1" data-testid="safe-change-changed-fields">
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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Affected
            </p>
            <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200" data-testid="safe-change-affected">
              {preview.affected.streams.length} stream(s) · {preview.affected.routes.length} route(s) ·{' '}
              {preview.affected.destinations.length} destination(s)
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{preview.delivery_impact}</p>
          </div>

          {preview.blocking_issues.length > 0 ? (
            <div data-testid="safe-change-blocking">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                Blocking
              </p>
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
            <div data-testid="safe-change-warnings">
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

          {preview.recommended_actions.length > 0 ? (
            <div data-testid="safe-change-recommendations">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Recommended
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                {preview.recommended_actions.map((action) => (
                  <li key={action.id}>{action.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
