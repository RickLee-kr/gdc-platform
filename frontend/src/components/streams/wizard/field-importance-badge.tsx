import { cn } from '../../../lib/utils'
import { FIELD_IMPORTANCE_LABEL, type FieldImportance } from '../../../lib/field-importance'

const TONE: Record<FieldImportance, string> = {
  required:
    'border-rose-300/80 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100',
  recommended:
    'border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
  optional:
    'border-slate-200/90 bg-slate-50 text-slate-600 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-mutedStrong',
}

export type FieldImportanceBadgeProps = {
  importance: FieldImportance
  className?: string
  title?: string
}

export function FieldImportanceBadge({ importance, className, title }: FieldImportanceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
        TONE[importance],
        className,
      )}
      title={title}
      data-testid={`field-importance-${importance}`}
    >
      {FIELD_IMPORTANCE_LABEL[importance]}
    </span>
  )
}
