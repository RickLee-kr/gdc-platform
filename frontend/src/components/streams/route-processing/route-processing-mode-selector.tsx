import { cn } from '../../../lib/utils'

export type RouteProcessingMode = 'shared' | 'override'

export function RouteProcessingModeSelector({
  mode,
  onChange,
  readonly,
  'data-testid': testId = 'route-processing-mode',
}: {
  mode: RouteProcessingMode
  onChange: (mode: RouteProcessingMode) => void
  readonly?: boolean
  'data-testid'?: string
}) {
  const options: ReadonlyArray<{ value: RouteProcessingMode; label: string; description: string }> = [
    {
      value: 'shared',
      label: 'Use Shared Processing',
      description: 'Inherit Transform, Protection, Classification, and Policy from the shared baseline.',
    },
    {
      value: 'override',
      label: 'Override for this Route',
      description: 'Configure Transform, Protection, Classification, or Policy specifically for this route.',
    },
  ]

  return (
    <div
      className="grid gap-2 sm:grid-cols-2"
      role="radiogroup"
      aria-label="Route processing mode"
      data-testid={testId}
    >
      {options.map((option) => {
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={readonly}
            onClick={() => {
              if (!readonly) onChange(option.value)
            }}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left transition-colors',
              active
                ? 'border-violet-400/80 bg-violet-500/[0.08] shadow-sm dark:border-violet-500/50 dark:bg-violet-500/15'
                : 'border-slate-200/90 bg-white hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
              readonly && 'cursor-default opacity-90',
            )}
            data-testid={`${testId}-${option.value}`}
          >
            <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{option.label}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-600 dark:text-gdc-muted">{option.description}</p>
          </button>
        )
      })}
    </div>
  )
}
