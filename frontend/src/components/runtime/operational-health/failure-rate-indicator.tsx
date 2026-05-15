import { cn } from '../../../lib/utils'

/** Renders failure rate (0..1) as label + compact bar; no fabricated values when rate is NaN. */
export function FailureRateIndicator({
  rate,
  label = 'Failure rate',
  className,
}: {
  rate: number | null | undefined
  label?: string
  className?: string
}) {
  if (rate == null || Number.isNaN(rate)) {
    return (
      <div className={cn('min-w-0', className)} data-testid="failure-rate-empty">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-gdc-muted">—</p>
      </div>
    )
  }
  const pct = Math.min(100, Math.max(0, rate * 100))
  const barTone = pct >= 25 ? 'bg-rose-500' : pct >= 8 ? 'bg-orange-500' : pct >= 1 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className={cn('min-w-0', className)} data-testid="failure-rate-indicator">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">{pct.toFixed(1)}%</p>
      <div className="mt-1 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
        <div className={cn('h-full rounded-full', barTone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
