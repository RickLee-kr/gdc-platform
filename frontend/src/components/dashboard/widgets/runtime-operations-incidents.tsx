import { AlertCircle, CheckCircle2, KeyRound, Package, ShieldAlert, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ValidationOperationalSummaryResponse } from '../../../api/types/gdcApi'
import { NAV_PATH } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'

type IncidentTone = 'neutral' | 'warn' | 'bad'

function IncidentCard({
  title,
  description,
  count,
  href,
  icon: Icon,
  activeStyle = 'critical',
}: {
  title: string
  description: string
  count: number | undefined
  href: string
  icon: typeof Package
  /** `caution` uses amber when count &gt; 0; `critical` uses rose. */
  activeStyle?: 'critical' | 'caution'
}) {
  const n = count ?? 0
  const healthy = n <= 0
  const tone: IncidentTone = healthy ? 'neutral' : activeStyle === 'caution' ? 'warn' : 'bad'
  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border p-3 shadow-sm transition-colors',
        tone === 'bad'
          ? 'border-rose-200/90 bg-rose-50/60 dark:border-rose-500/35 dark:bg-rose-500/10'
          : tone === 'warn'
            ? 'border-amber-200/90 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10'
            : 'border-slate-200/80 bg-white dark:border-gdc-border dark:bg-gdc-section',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-gdc-muted">{description}</p>
        </div>
        {healthy ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="OK" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-label="Attention" />
        )}
      </div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{n}</p>
      <Link
        to={href}
        className="mt-2 inline-flex text-[10px] font-semibold text-violet-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:text-violet-300"
      >
        Details →
      </Link>
    </div>
  )
}

export function RuntimeOperationsIncidents({
  operational,
  loading,
}: {
  operational: ValidationOperationalSummaryResponse | null | undefined
  loading: boolean
}) {
  const o = operational

  return (
    <section
      aria-label="Runtime operations incidents"
      className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3 dark:border-gdc-border dark:bg-gdc-card/40"
    >
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Runtime incidents</h2>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
            Live runtime posture (current_runtime): delivery routes, auth, and checkpoints with active failures — not
            historical OPEN alerts. See Analytics for full-window history.
          </p>
        </div>
        <Link
          to={NAV_PATH.validation}
          className="text-[10px] font-semibold text-violet-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:text-violet-300"
        >
          Advanced health checks →
        </Link>
      </div>
      {loading && !o ? (
        <p className="text-[11px] text-slate-500 dark:text-gdc-muted" role="status">
          Loading incident signals…
        </p>
      ) : null}
      {o || !loading ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <IncidentCard
            title="Delivery unhealthy"
            description="Open delivery-path failures surfaced by runtime verification."
            count={o?.open_delivery_failure_alerts}
            href={`${NAV_PATH.validation}/delivery`}
            icon={Package}
          />
          <IncidentCard
            title="Delivery health degraded"
            description="Checks reporting degraded posture (not yet failing)."
            count={o?.degraded_validations_count}
            href={NAV_PATH.validation}
            icon={ShieldAlert}
            activeStyle="caution"
          />
          <IncidentCard
            title="Checkpoint stalled"
            description="Checkpoint drift or stall alerts requiring attention."
            count={o?.open_checkpoint_drift_alerts}
            href={`${NAV_PATH.validation}/checkpoints`}
            icon={Timer}
          />
          <IncidentCard
            title="Auth unhealthy"
            description="Authentication or credential health alerts."
            count={o?.open_auth_failure_alerts}
            href={`${NAV_PATH.validation}/auth`}
            icon={KeyRound}
          />
        </div>
      ) : null}
    </section>
  )
}
