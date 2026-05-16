import { cn } from '../../lib/utils'
import { type OperationalStreamBadge } from '../../utils/streamOperationalBadges'

const VARIANT: Record<OperationalStreamBadge['variant'], string> = {
  emerald:
    'border-emerald-200/90 bg-emerald-500/[0.08] text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100',
  violet:
    'border-violet-200/90 bg-violet-500/[0.08] text-violet-900 dark:border-violet-500/35 dark:bg-violet-500/10 dark:text-violet-100',
  amber:
    'border-amber-200/90 bg-amber-500/[0.08] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100',
}

type Props = {
  badges: OperationalStreamBadge[]
  className?: string
}

/** Small pills for runtime capability + dataset provenance (seed / lab). */
export function StreamOperationalBadges({ badges, className }: Props) {
  if (!badges.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label="Stream capability and dataset">
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.title}
          className={cn(
            'inline-flex max-w-[min(100%,280px)] cursor-default truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-tight',
            VARIANT[b.variant],
          )}
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}
