import { EyeOff, ShieldAlert } from 'lucide-react'
import { cn } from '../../lib/utils'

type PolicyRuntimeNoticeProps = {
  compact?: boolean
  className?: string
}

/** M18.1 — Named policies are catalog/preview only; StreamRunner enforcement is not wired. */
export function PolicyRuntimeNotice({ compact = false, className }: PolicyRuntimeNoticeProps) {
  return (
    <div
      role="status"
      data-testid="policy-runtime-notice"
      className={cn(
        'rounded-lg border border-amber-300/70 bg-amber-500/[0.08] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        className,
      )}
    >
      <div className={cn('flex gap-2', compact ? 'items-center' : 'items-start')}>
        <ShieldAlert
          className={cn('shrink-0 text-amber-700 dark:text-amber-300', compact ? 'h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')}
          aria-hidden
        />
        <div className={cn(compact ? 'text-[11px]' : 'text-[12px]')}>
          <p className="font-semibold">Preview only</p>
          <p className={cn('text-amber-900/90 dark:text-amber-100/90', compact ? 'mt-0' : 'mt-0.5')}>
            Runtime enforcement not enabled — saved policies and stream assignments do not affect StreamRunner or
            delivery yet.
          </p>
        </div>
      </div>
      {!compact ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-800/90 dark:text-amber-200/90">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          Per-stream response rules in Monitoring still use the existing M8 Policy Engine until a later milestone
          connects Named Policies to runtime.
        </p>
      ) : null}
    </div>
  )
}
