import { Link } from 'react-router-dom'
import { NAV_PATH, runtimeAnalyticsPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import type { MetricsWindow } from '../../../api/gdcRuntime'
import type { HealthLevelBreakdown } from '../../../api/types/gdcApi'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'

export type OpsRouteHealthSummaryWidgetProps = {
  routes: HealthLevelBreakdown | null
  destinations: HealthLevelBreakdown | null
  window: MetricsWindow
  loading: boolean
}

function barCounts(b: HealthLevelBreakdown | null): { total: number; bad: number } {
  if (!b) return { total: 0, bad: 0 }
  const total = b.healthy + b.degraded + b.unhealthy + b.critical + (b.idle ?? 0) + (b.disabled ?? 0)
  const bad = b.degraded + b.unhealthy + b.critical
  return { total, bad }
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
      title="Current route posture"
      subtitle="Current runtime posture only: active, idle, disabled, degraded, and failed route state."
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
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Routes</p>
          {!routes ? (
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Not available.</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                <li>
                  <span className="text-emerald-700 dark:text-emerald-400">Healthy</span> {routes.healthy}
                </li>
                <li>
                  <span className="text-amber-800 dark:text-amber-400">Degraded</span> {routes.degraded}
                </li>
                <li>
                  <span className="text-orange-800 dark:text-orange-400">Unhealthy</span> {routes.unhealthy}
                </li>
                <li>
                  <span className="text-red-800 dark:text-red-400">Critical</span> {routes.critical}
                </li>
                <li>
                  <span className="text-slate-600 dark:text-slate-400">Idle</span> {routes.idle ?? 0}
                </li>
                <li>
                  <span className="text-slate-500 dark:text-slate-500">Disabled</span> {routes.disabled ?? 0}
                </li>
              </ul>
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
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                <li>
                  <span className="text-emerald-700 dark:text-emerald-400">Healthy</span> {destinations.healthy}
                </li>
                <li>
                  <span className="text-amber-800 dark:text-amber-400">Degraded</span> {destinations.degraded}
                </li>
                <li>
                  <span className="text-orange-800 dark:text-orange-400">Unhealthy</span> {destinations.unhealthy}
                </li>
                <li>
                  <span className="text-red-800 dark:text-red-400">Critical</span> {destinations.critical}
                </li>
              </ul>
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                {d.total > 0
                  ? `${d.bad} destination${d.bad === 1 ? '' : 's'} need attention.`
                  : 'No destination scores in this window.'}
              </p>
            </>
          )}
        </div>
        <p className="text-[10px] text-slate-500 dark:text-gdc-muted sm:col-span-2">
          Degraded = elevated failure/retry/inactivity signals. Critical / unhealthy often correlate with unreachable hosts,
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
