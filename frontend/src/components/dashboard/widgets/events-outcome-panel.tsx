import { Link } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { NAV_PATH } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import type { DashboardSummaryNumbers } from '../../../api/types/gdcApi'

const COLORS = {
  success: '#16a34a',
  failed: '#dc2626',
  rateLimited: '#d97706',
} as const

export type EventsOutcomePanelProps = {
  summary: DashboardSummaryNumbers | null
  loading: boolean
  className?: string
}

export function EventsOutcomePanel({ summary, loading, className }: EventsOutcomePanelProps) {
  const ok = summary?.recent_successes ?? 0
  const fail = summary?.recent_failures ?? 0
  const rl = summary?.recent_rate_limited ?? 0
  const total = ok + fail + rl

  const data =
    total > 0
      ? [
          { name: 'Success', value: ok, color: COLORS.success },
          { name: 'Rate limited', value: rl, color: COLORS.rateLimited },
          { name: 'Failed', value: fail, color: COLORS.failed },
        ]
      : []

  return (
    <RuntimeChartCard
      className={cn('h-full min-h-0 lg:col-span-4', className)}
      title="Events by outcome"
      subtitle="Delivery log rows in the selected window (success, rate limited, failed)."
      actions={
        <Link
          to={NAV_PATH.logs}
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Logs
        </Link>
      }
    >
      <div
        className={cn('relative flex min-h-[268px] flex-col items-center justify-center', loading && 'opacity-80')}
        aria-busy={loading}
      >
        {total <= 0 ? (
          <p className="px-2 text-center text-[12px] text-slate-500 dark:text-gdc-muted">
            No delivery activity in this window.
          </p>
        ) : (
          <>
            <div className="relative mx-auto h-[200px] w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={78}
                    paddingAngle={1.5}
                    stroke="none"
                  >
                    {data.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value}`, name]}
                    contentStyle={{
                      borderRadius: 6,
                      border: '1px solid rgb(226 232 240 / 0.95)',
                      fontSize: 11,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{total}</p>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  events
                </p>
              </div>
            </div>
            <ul className="mt-2 w-full max-w-[240px] space-y-1 text-[11px] text-slate-600 dark:text-gdc-muted">
              {data.map((d) => (
                <li key={d.name} className="flex justify-between gap-2 tabular-nums">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </span>
                  <span>
                    {d.value} ({total > 0 ? Math.round((d.value / total) * 1000) / 10 : 0}%)
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </RuntimeChartCard>
  )
}
