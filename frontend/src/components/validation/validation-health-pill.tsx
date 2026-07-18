import { cn } from '../../lib/utils'
import { formatUserHealthLabel } from '../../lib/operational-health-present'

export function validationHealthTone(status: string): 'emerald' | 'amber' | 'rose' | 'slate' {
  const label = formatUserHealthLabel(status)
  if (label === 'Healthy') return 'emerald'
  if (label === 'Warning') return 'amber'
  if (label === 'Critical') return 'rose'
  return 'slate'
}

export function ValidationHealthPill({ status }: { status: string }) {
  const tone = validationHealthTone(status)
  const label = formatUserHealthLabel(status === 'FAILING' ? 'FAILING' : status)
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
      aria-label={`Health ${label}`}
      title={label}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        cls,
      )}
      data-health-raw={status}
      data-health-label={label}
    >
      {label}
    </span>
  )
}
