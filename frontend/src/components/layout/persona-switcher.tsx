import { cn } from '../../lib/utils'
import { PERSONA_LABELS, type PlatformPersona } from '../../utils/persona-mode'

type PersonaSwitcherProps = {
  persona: PlatformPersona
  collapsed: boolean
  onPersonaChange: (persona: PlatformPersona) => void
}

const OPTIONS: readonly PlatformPersona[] = ['connector', 'governance'] as const

export function PersonaSwitcher({ persona, collapsed, onPersonaChange }: PersonaSwitcherProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-0.5" data-testid="persona-switcher">
        {OPTIONS.map((key) => {
          const active = persona === key
          const short = key === 'connector' ? 'C' : 'G'
          return (
            <button
              key={key}
              type="button"
              title={PERSONA_LABELS[key]}
              aria-pressed={active}
              data-testid={key === 'connector' ? 'persona-switch-connector' : 'persona-switch-governance'}
              onClick={() => onPersonaChange(key)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold transition-colors',
                active
                  ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
              )}
            >
              {short}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-1" data-testid="persona-switcher">
      <p className="px-2 text-[9px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Persona</p>
      <div
        className="flex rounded-md border border-slate-200/80 bg-slate-50/80 p-0.5 dark:border-gdc-border dark:bg-gdc-section"
        role="group"
        aria-label="Persona mode"
      >
        {OPTIONS.map((key) => {
          const active = persona === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              data-testid={key === 'connector' ? 'persona-switch-connector' : 'persona-switch-governance'}
              onClick={() => onPersonaChange(key)}
              className={cn(
                'flex-1 rounded px-1.5 py-1 text-[10px] font-semibold leading-tight transition-colors',
                active
                  ? 'bg-white text-violet-800 shadow-sm dark:bg-gdc-card dark:text-violet-200'
                  : 'text-slate-600 hover:text-slate-800 dark:text-gdc-muted dark:hover:text-gdc-foreground',
              )}
            >
              {PERSONA_LABELS[key]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
