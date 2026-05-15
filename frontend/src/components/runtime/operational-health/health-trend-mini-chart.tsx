import { cn } from '../../../lib/utils'

/** Compact sparkline from non-negative samples (e.g. failure buckets). */
export function HealthTrendMiniChart({
  values,
  className,
  strokeClassName = 'text-violet-600 dark:text-violet-400',
  height = 36,
}: {
  values: readonly number[]
  className?: string
  strokeClassName?: string
  height?: number
}) {
  const w = 120
  const padX = 2
  const padY = 2
  const nums = values.length ? [...values] : []
  if (nums.length === 0) {
    return (
      <div
        className={cn('text-[10px] text-slate-500 dark:text-gdc-muted', className)}
        data-testid="health-trend-empty"
        style={{ height }}
      >
        No trend samples
      </div>
    )
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const innerW = w - padX * 2
  const innerH = height - padY * 2
  const pts = nums.map((v, i) => {
    const x = padX + (i / Math.max(nums.length - 1, 1)) * innerW
    const y = padY + (1 - (v - min) / range) * innerH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      className={cn('shrink-0', strokeClassName, className)}
      data-testid="health-trend-mini-chart"
      aria-hidden
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts.join(' ')} />
    </svg>
  )
}
