import { cn } from '../../../lib/utils'

export function RouteProcessingInheritToggle({
  checked,
  onChange,
  concernLabel,
  disabled,
  'data-testid': testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  concernLabel: string
  disabled?: boolean
  'data-testid'?: string
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-[12px] font-medium dark:border-gdc-border dark:bg-gdc-section/60',
        disabled && 'opacity-60',
      )}
      data-testid={testId}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-violet-600"
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <span className="text-slate-800 dark:text-slate-100">Inherit Shared</span>
      <span className="text-[10px] text-slate-500 dark:text-gdc-muted">({concernLabel})</span>
      {checked ? (
        <span className="ml-auto text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Inherited</span>
      ) : (
        <span className="ml-auto text-[10px] font-semibold text-amber-700 dark:text-amber-300">Override active</span>
      )}
    </label>
  )
}
