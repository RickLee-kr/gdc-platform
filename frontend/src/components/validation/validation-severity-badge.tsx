import { cn } from '../../lib/utils'

export function ValidationSeverityBadge({ severity }: { severity: string }) {
  const s = severity.toUpperCase()
  const cls =
    s === 'CRITICAL'
      ? 'bg-rose-600/15 text-rose-700 ring-rose-600/30 dark:text-rose-200'
      : s === 'WARNING'
        ? 'bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-100'
        : s === 'INFO'
          ? 'bg-sky-500/15 text-sky-800 ring-sky-500/30 dark:text-sky-100'
          : 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200'
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        cls,
      )}
    >
      {s}
    </span>
  )
}
