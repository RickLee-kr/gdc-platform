import { Activity, AlertTriangle, CheckCircle2, FolderOpen, Layers, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { StreamsPageKpi } from '../../lib/stream-console-metrics'

function MiniSparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 72
  const h = 28
  const padX = 2
  const padY = 2
  const nums = values.length ? [...values] : [0]
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const pts = nums.map((v, i) => {
    const x = padX + (i / Math.max(nums.length - 1, 1)) * innerW
    const y = padY + (1 - (v - min) / range) * innerH
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn('shrink-0', className)} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" points={pts.join(' ')} />
    </svg>
  )
}

function sparkFromCount(count: number, total: number): number[] {
  const ratio = total > 0 ? count / total : 0
  return [ratio * 0.6, ratio * 0.7, ratio * 0.8, ratio * 0.85, ratio * 0.9, ratio * 0.95, ratio]
}

type KpiCardProps = {
  label: string
  value: string
  sub?: string
  icon: typeof Activity
  iconClassName: string
  sparkline?: readonly number[]
  sparklineClassName?: string
}

function KpiCard({ label, value, sub, icon: Icon, iconClassName, sparkline, sparklineClassName }: KpiCardProps) {
  return (
    <div
      className="flex min-h-[6.5rem] flex-col rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid={`streams-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-gdc-muted">{sub}</p> : null}
        </div>
        <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconClassName)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      {sparkline ? (
        <div className="mt-auto flex justify-end pt-2">
          <MiniSparkline values={sparkline} className={sparklineClassName} />
        </div>
      ) : null}
    </div>
  )
}

export function StreamsGroupKpiStrip({ kpi, loading }: { kpi: StreamsPageKpi; loading?: boolean }) {
  if (loading) {
    return (
      <section aria-label="Streams KPI summary" className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-slate-200/70 dark:bg-gdc-elevated" aria-hidden />
        ))}
      </section>
    )
  }

  const healthySpark = sparkFromCount(kpi.healthyGroups, kpi.totalGroups)
  const warningSpark = sparkFromCount(kpi.warningGroups, kpi.totalGroups)
  const criticalSpark = sparkFromCount(kpi.criticalGroups, kpi.totalGroups)

  return (
    <section aria-label="Streams KPI summary" data-testid="streams-group-kpi-strip" className="grid grid-cols-2 gap-3 xl:grid-cols-6">
      <KpiCard
        label="Total Stream Groups"
        value={String(kpi.totalGroups)}
        icon={FolderOpen}
        iconClassName="bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400"
      />
      <KpiCard
        label="Total Streams"
        value={String(kpi.totalStreams)}
        icon={Layers}
        iconClassName="bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"
      />
      <KpiCard
        label="Healthy Groups"
        value={String(kpi.healthyGroups)}
        sub={kpi.healthyPct}
        icon={CheckCircle2}
        iconClassName="bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
        sparkline={healthySpark}
        sparklineClassName="text-emerald-500 dark:text-emerald-400"
      />
      <KpiCard
        label="Warning Groups"
        value={String(kpi.warningGroups)}
        sub={kpi.warningPct}
        icon={AlertTriangle}
        iconClassName="bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
        sparkline={warningSpark}
        sparklineClassName="text-amber-500 dark:text-amber-400"
      />
      <KpiCard
        label="Critical Groups"
        value={String(kpi.criticalGroups)}
        sub={kpi.criticalPct}
        icon={XCircle}
        iconClassName="bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400"
        sparkline={criticalSpark}
        sparklineClassName="text-red-500 dark:text-red-400"
      />
      <KpiCard
        label="Total Issues"
        value={String(kpi.totalIssues)}
        icon={Activity}
        iconClassName="bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400"
      />
    </section>
  )
}
