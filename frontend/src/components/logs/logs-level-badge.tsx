import { cn } from '../../lib/utils'
import type { LogLevel } from './logs-types'

export function LevelBadge({ level }: { level: LogLevel }) {
  const cls =
    level === 'ERROR'
      ? 'border-red-600/40 bg-red-600/[0.12] text-red-950 shadow-sm dark:border-red-500/50 dark:bg-red-950/55 dark:text-red-100'
      : level === 'WARN'
        ? 'border-amber-500/25 bg-amber-500/[0.09] text-amber-950 dark:border-amber-500/35 dark:bg-amber-950/35 dark:text-amber-200'
        : level === 'INFO'
          ? 'border-sky-500/25 bg-sky-500/[0.09] text-sky-950 dark:border-sky-500/35 dark:bg-sky-950/45 dark:text-sky-200'
          : 'border-violet-500/25 bg-violet-500/[0.09] text-violet-950 dark:border-violet-500/35 dark:bg-violet-950/45 dark:text-violet-200'
  return (
    <span className={cn('inline-flex rounded-md border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', cls)}>
      {level}
    </span>
  )
}
