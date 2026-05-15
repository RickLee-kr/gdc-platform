import { FlaskConical } from 'lucide-react'
import { cn } from '../../lib/utils'
import { isDevValidationLabEntityName } from '../../utils/devValidationLab'

export function DevValidationBadge({
  name,
  className,
}: {
  name: string | null | undefined
  className?: string
}) {
  if (!isDevValidationLabEntityName(name)) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-amber-300/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100',
        className,
      )}
      title="Development validation lab or local E2E fixtures (non-production seed)"
    >
      <FlaskConical className="h-3 w-3" aria-hidden />
      Dev lab
    </span>
  )
}
