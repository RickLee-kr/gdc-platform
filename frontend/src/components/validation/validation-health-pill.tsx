import { cn } from '../../lib/utils'

export function validationHealthTone(status: string): 'emerald' | 'amber' | 'rose' | 'slate' {
  const s = status.toUpperCase()
  if (s === 'HEALTHY') return 'emerald'
  if (s === 'DEGRADED') return 'amber'
  if (s === 'FAILING') return 'rose'
  return 'slate'
}

export function ValidationHealthPill({ status }: { status: string }) {
  const tone = validationHealthTone(status)
  const cls =
    tone === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
        : tone === 'rose'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100'
          : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-gdc-borderStrong dark:bg-gdc-elevated dark:text-slate-200'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        cls,
      )}
    >
      {status}
    </span>
  )
}
