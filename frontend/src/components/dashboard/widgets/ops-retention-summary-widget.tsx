import { HardDrive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import type { RetentionStatusResponse } from '../../../api/types/gdcApi'

function shortTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  return String(iso).slice(0, 19).replace('T', ' ')
}

export type OpsRetentionSummaryWidgetProps = {
  status: RetentionStatusResponse | null
  loading: boolean
}

export function OpsRetentionSummaryWidget({ status, loading }: OpsRetentionSummaryWidgetProps) {
  const policies = status?.policies ?? null
  const keys = policies ? Object.keys(policies).sort() : []

  return (
    <RuntimeChartCard
      title="Operational retention"
      subtitle="Last cleanup and configured retention days (PostgreSQL operational tables)."
      actions={
        <Link to={NAV_PATH.settings} className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          Settings
        </Link>
      }
    >
      <div className={cn('space-y-2', loading && 'opacity-80')} aria-busy={loading}>
        {!status && !loading ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Retention status not available.</p>
        ) : null}
        {status ? (
          <>
            <div
              className={cn(
                'rounded-md border px-2 py-1.5 text-[11px] font-medium',
                status.last_operational_retention_at
                  ? 'border-emerald-200/80 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-100'
                  : 'border-amber-300/80 bg-amber-500/[0.08] text-amber-950 dark:border-amber-800/45 dark:bg-amber-950/25 dark:text-amber-100',
              )}
              role="status"
            >
              {status.last_operational_retention_at
                ? 'Operational retention sweep has run at least once in this environment.'
                : 'No recorded operational retention sweep yet — confirm scheduler health in Admin settings.'}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
              <HardDrive className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span>
                Last operational cleanup:{' '}
                <span className="font-mono font-medium tabular-nums">{shortTs(status.last_operational_retention_at)}</span>
              </span>
            </div>
            {keys.length ? (
              <ul className="max-h-[120px] space-y-0.5 overflow-auto text-[11px] text-slate-600 dark:text-gdc-muted">
                {keys.map((k) => (
                  <li key={k} className="flex justify-between gap-2 tabular-nums">
                    <span className="min-w-0 truncate font-mono text-[10px]" title={k}>
                      {k}
                    </span>
                    <span className="shrink-0 font-medium text-slate-800 dark:text-slate-200">
                      {policies![k] as number} days
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-gdc-muted">No policy keys returned.</p>
            )}
            {status.supplement_next_after_utc ? (
              <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
                Supplement scheduler next: <span className="font-mono">{shortTs(status.supplement_next_after_utc)}</span>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </RuntimeChartCard>
  )
}
