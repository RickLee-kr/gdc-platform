import { Link } from 'react-router-dom'
import { NAV_PATH, runtimeAnalyticsPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import type { MetricsWindow } from '../../../api/gdcRuntime'
import type { HealthLevelBreakdown } from '../../../api/types/gdcApi'
import { OP_LABEL } from '../../../lib/operator-vocabulary'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'

export type OpsRouteHealthSummaryWidgetProps = {
  routes: HealthLevelBreakdown | null
  destinations: HealthLevelBreakdown | null
  window: MetricsWindow
  loading: boolean
}

function barCounts(b: HealthLevelBreakdown | null): {
  total: number
  bad: number
  healthy: number
  warning: number
  critical: number
  unknown: number
  disabled: number
} {
  if (!b) return { total: 0, bad: 0, healthy: 0, warning: 0, critical: 0, unknown: 0, disabled: 0 }
  const healthy = b.healthy
  const warning = b.degraded
  const critical = b.unhealthy + b.critical
  const unknown = b.idle ?? 0
  const disabled = b.disabled ?? 0
  const total = healthy + warning + critical + unknown + disabled
  const bad = warning + critical
  return { total, bad, healthy, warning, critical, unknown, disabled }
}

function HealthCountList({
  healthy,
  warning,
  critical,
  unknown,
  disabled,
  showDisabled,
}: {
  healthy: number
  warning: number
  critical: number
  unknown?: number
  disabled?: number
  showDisabled?: boolean
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
      <li>
        <span className="text-emerald-700 dark:text-emerald-400">Healthy</span> {healthy}
      </li>
      <li>
        <span className="text-amber-800 dark:text-amber-400">Warning</span> {warning}
      </li>
      <li>
        <span className="text-red-800 dark:text-red-400">Critical</span> {critical}
      </li>
      {unknown != null ? (
        <li>
          <span className="text-slate-600 dark:text-slate-400">Unknown</span> {unknown}
        </li>
      ) : null}
      {showDisabled && disabled != null ? (
        <li>
          <span className="text-slate-500 dark:text-slate-500">Disabled</span> {disabled}
        </li>
      ) : null}
    </ul>
  )
}

export function OpsRouteHealthSummaryWidget({
  routes,
  destinations,
  window,
  loading,
}: OpsRouteHealthSummaryWidgetProps) {
  const r = barCounts(routes)
  const d = barCounts(destinations)

  return (
    <RuntimeChartCard
      title="Current delivery path posture"
      subtitle="Current platform posture only: healthy, warning, critical, unknown, and disabled delivery path state."
      actions={
        <Link
          to={runtimeAnalyticsPath({ window })}
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Analytics
        </Link>
      }
    >
      <div className={cn('grid gap-3 sm:grid-cols-2', loading && 'opacity-80')} aria-busy={loading}>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{OP_LABEL.deliveryPaths}</p>
          {!routes ? (
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Not available.</p>
          ) : (
            <>
              <HealthCountList
                healthy={r.healthy}
                warning={r.warning}
                critical={r.critical}
                unknown={r.unknown}
                disabled={r.disabled}
                showDisabled
              />
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                {r.total > 0
                  ? `${r.bad} route${r.bad === 1 ? '' : 's'} below healthy threshold (${Math.round((100 * r.bad) / r.total)}% of configured routes).`
                  : 'No configured routes in this scope.'}
              </p>
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Destinations</p>
          {!destinations ? (
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Not available.</p>
          ) : (
            <>
              <HealthCountList healthy={d.healthy} warning={d.warning} critical={d.critical} />
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                {d.total > 0
                  ? `${d.bad} destination${d.bad === 1 ? '' : 's'} need attention.`
                  : 'No destination scores in this window.'}
              </p>
            </>
          )}
        </div>
        <p className="text-[10px] text-slate-500 dark:text-gdc-muted sm:col-span-2">
          Warning = elevated failure/retry/inactivity signals. Critical often correlates with unreachable hosts,
          exhausted retries, or sustained delivery log errors — open{' '}
          <Link to={NAV_PATH.logs} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
            Logs
          </Link>{' '}
          for correlation.
        </p>
      </div>
    </RuntimeChartCard>
  )
}
