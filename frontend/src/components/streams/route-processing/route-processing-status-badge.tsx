import { cn } from '../../../lib/utils'
import type { RouteProcessingStatus } from '../wizard/wizard-state'

function statusTone(status: RouteProcessingStatus): string {
  switch (status) {
    case 'Inherited':
      return 'text-slate-500 dark:text-gdc-muted'
    case 'Overridden':
      return 'text-amber-700 dark:text-amber-300'
    case 'Mixed':
      return 'text-violet-700 dark:text-violet-300'
    default:
      return 'text-slate-500'
  }
}

export function RouteProcessingStatusLabel({
  status,
  className,
  'data-testid': testId,
}: {
  status: RouteProcessingStatus
  className?: string
  'data-testid'?: string
}) {
  return (
    <span
      className={cn('text-[11px] font-semibold', statusTone(status), className)}
      data-testid={testId ?? `route-processing-status-${status.toLowerCase()}`}
    >
      {status}
    </span>
  )
}

export function RouteProcessingStatusRow({
  label,
  status,
}: {
  label: string
  status: RouteProcessingStatus
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-slate-600 dark:text-gdc-muted">{label}</span>
      <RouteProcessingStatusLabel status={status} />
    </div>
  )
}
