import { AlertTriangle } from 'lucide-react'
import { HELP_COPY } from '../ui/help-tooltip-copy'

export type NoCheckpointWarningProps = {
  /** Primary checkpoint path / variable currently configured. */
  checkpointPath: string
  /** Optional secondary checkpoint path that also satisfies the requirement. */
  secondaryPath?: string
}

/**
 * Context-aware inline warning shown only when no checkpoint variable is
 * configured. Stays quiet by default — once any checkpoint path is set, the
 * warning disappears.
 */
export function NoCheckpointWarning({ checkpointPath, secondaryPath }: NoCheckpointWarningProps) {
  const hasCheckpoint = (checkpointPath?.trim() ?? '').length > 0 || (secondaryPath?.trim() ?? '').length > 0
  if (hasCheckpoint) return null
  return (
    <div
      role="status"
      data-testid="no-checkpoint-warning"
      className="flex items-start gap-1.5 rounded-md border border-amber-300/70 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {HELP_COPY.noCheckpointWarning.content}{' '}
        <span className="font-mono text-[10px]">{HELP_COPY.noCheckpointWarning.example}</span>
      </span>
    </div>
  )
}
