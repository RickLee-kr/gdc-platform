import { cn } from '../../../lib/utils'
import type { RouteProcessingStatus } from '../wizard/wizard-state'
import { RouteProcessingStatusBadge } from './route-processing-status-badge'

export function RouteProcessingInheritToggle({
  checked,
  onChange,
  concernLabel,
  disabled,
  readonly,
  processingStatus,
  statusPending,
  'data-testid': testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  concernLabel: string
  disabled?: boolean
  /** When true, mirrors Effective API status — checkbox is disabled and not editable. */
  readonly?: boolean
  /** Effective API `processing_status`; null = unavailable; omit when statusPending. */
  processingStatus?: RouteProcessingStatus | null
  /** When true with readonly, shows loading state instead of Unavailable. */
  statusPending?: boolean
  'data-testid'?: string
}) {
  const mirrorChecked = readonly && processingStatus === 'Inherited'
  const effectiveChecked = readonly ? mirrorChecked : checked
  const isDisabled = disabled || readonly

  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-[12px] font-medium dark:border-gdc-border dark:bg-gdc-section/60',
        isDisabled && 'cursor-default opacity-90',
        disabled && !readonly && 'opacity-60',
      )}
      data-testid={testId}
      data-readonly={readonly ? 'true' : undefined}
    >
      <input
        type="checkbox"
        checked={effectiveChecked}
        disabled={isDisabled}
        readOnly={readonly}
        onChange={(e) => {
          if (!readonly) onChange(e.target.checked)
        }}
        className="accent-violet-600"
        data-testid={testId ? `${testId}-input` : undefined}
        aria-readonly={readonly ? true : undefined}
      />
      <span className="text-slate-800 dark:text-slate-100">Inherit Shared</span>
      <span className="text-[10px] text-slate-500 dark:text-gdc-muted">({concernLabel})</span>
      {readonly ? (
        statusPending ? (
          <span
            className="ml-auto text-[10px] font-semibold text-slate-400 dark:text-gdc-muted"
            data-testid={testId ? `${testId}-status-pending` : undefined}
          >
            …
          </span>
        ) : processingStatus != null ? (
          <RouteProcessingStatusBadge status={processingStatus} className="ml-auto" />
        ) : (
          <span
            className="ml-auto rounded-full border border-slate-200/90 bg-slate-100/80 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted"
            data-testid={testId ? `${testId}-status-unavailable` : undefined}
          >
            Unavailable
          </span>
        )
      ) : checked ? (
        <span className="ml-auto rounded-full border border-slate-200/90 bg-slate-100/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted">
          Shared
        </span>
      ) : (
        <span className="ml-auto rounded-full border border-amber-300/80 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-500/40 dark:text-amber-100">
          Override active
        </span>
      )}
    </label>
  )
}
