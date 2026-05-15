import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral' | 'info'

const toneClass: Record<StatusTone, string> = {
  success:
    'border-emerald-500/15 bg-emerald-500/[0.08] text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100/90',
  warning:
    'border-amber-500/20 bg-amber-500/[0.08] text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100/85',
  error: 'border-red-500/15 bg-red-500/[0.07] text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100/90',
  neutral: 'border-slate-300/40 bg-slate-500/[0.06] text-slate-800 dark:border-gdc-borderStrong/40 dark:bg-slate-400/10 dark:text-slate-200',
  info: 'border-sky-500/15 bg-sky-500/[0.07] text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100/90',
}

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone: StatusTone
}

export function StatusBadge({ tone, className, ...rest }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium tabular-nums tracking-tight',
        toneClass[tone],
        className,
      )}
      {...rest}
    />
  )
}
