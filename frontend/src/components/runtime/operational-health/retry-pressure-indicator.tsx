import { cn } from '../../../lib/utils'

export function RetryPressureIndicator({
  retryEventCount,
  retryRate,
  label = 'Retry pressure',
  className,
}: {
  retryEventCount: number | null | undefined
  retryRate: number | null | undefined
  label?: string
  className?: string
}) {
  const events = retryEventCount ?? 0
  const rate = retryRate != null && !Number.isNaN(retryRate) ? retryRate : null
  const pressureHigh = rate != null && rate >= 0.15
  return (
    <div className={cn('min-w-0', className)} data-testid="retry-pressure-indicator">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-[12px] font-semibold tabular-nums',
          pressureHigh ? 'text-amber-800 dark:text-amber-200' : 'text-slate-900 dark:text-slate-50',
        )}
      >
        {events.toLocaleString()} events
        {rate != null ? <span className="ml-1 font-normal text-slate-500 dark:text-gdc-muted">({(rate * 100).toFixed(1)}%)</span> : null}
      </p>
    </div>
  )
}
