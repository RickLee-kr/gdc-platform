import { AlertTriangle, ShieldAlert, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ValidationOperationalSummaryResponse } from '../../../api/types/gdcApi'
import { NAV_PATH } from '../../../config/nav-paths'
import { ValidationSeverityBadge } from '../../validation/validation-severity-badge'

export function ValidationOperationalWidget({
  operational,
  loading,
}: {
  operational: ValidationOperationalSummaryResponse | null | undefined
  loading: boolean
}) {
  const o = operational
  return (
    <section
      className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-section"
      aria-label="Delivery and checkpoint health telemetry"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 dark:border-gdc-border">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <div>
            <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Delivery health telemetry</h2>
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Runtime verification outcomes and alert posture</p>
          </div>
        </div>
        <Link
          to={NAV_PATH.validation}
          className="text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          View health checks
        </Link>
      </div>
      {loading && !o ? (
        <p className="pt-2 text-[11px] text-slate-500" role="status">
          Loading…
        </p>
      ) : null}
      {o ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-slate-100 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Failing</p>
            <p className="font-mono text-lg font-bold text-rose-600 dark:text-rose-400">{o.failing_validations_count}</p>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Degraded</p>
            <p className="font-mono text-lg font-bold text-amber-700 dark:text-amber-300">{o.degraded_validations_count}</p>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Open critical</p>
            <p className="font-mono text-lg font-bold text-rose-700 dark:text-rose-300">{o.open_alerts_critical}</p>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Checkpoint drift</p>
            <p className="font-mono text-lg font-bold text-violet-700 dark:text-violet-300">{o.open_checkpoint_drift_alerts}</p>
            <Link
              to={`${NAV_PATH.validation}/checkpoints`}
              className="mt-1 inline-block text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              Checkpoints →
            </Link>
          </div>
        </div>
      ) : null}
      {o && o.latest_open_alerts.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Latest open alerts</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">
            {o.latest_open_alerts.slice(0, 6).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-1.5 rounded border border-slate-100 px-2 py-1 dark:border-gdc-border"
              >
                <ValidationSeverityBadge severity={a.severity} />
                <span className="font-mono text-[10px] text-slate-500">#{a.validation_id}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{a.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {o && o.latest_recoveries.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-2 dark:border-gdc-border">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3 w-3 text-emerald-600" aria-hidden />
            Recent recoveries
          </p>
          <ul className="space-y-1 text-[11px] text-slate-700 dark:text-slate-200">
            {o.latest_recoveries.slice(0, 4).map((r) => (
              <li key={r.id} className="truncate">
                <span className="font-medium">{r.title}</span>
                <span className="text-slate-500"> · val #{r.validation_id}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {o && o.open_alerts_critical === 0 && o.latest_open_alerts.length === 0 ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
          <AlertTriangle className="h-3.5 w-3.5 opacity-40" aria-hidden />
          No open health check alerts.
        </p>
      ) : null}
    </section>
  )
}
