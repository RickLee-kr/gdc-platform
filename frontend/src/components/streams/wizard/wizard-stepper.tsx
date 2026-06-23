import { cn } from '../../../lib/utils'
import { wizardStepReachable, type WizardStepReachableOptions } from './wizard-step-gates'
import type { WizardState, WizardStepCompletion, WizardStepDef } from './wizard-state'

export type WizardStepperProps = {
  wizardSteps: readonly WizardStepDef[]
  stepIndex: number
  setStepIndex: (idx: number) => void
  completion: WizardStepCompletion
  state: WizardState
  reachability?: WizardStepReachableOptions
  className?: string
}

export function WizardStepper({
  wizardSteps,
  stepIndex,
  setStepIndex,
  completion,
  state,
  reachability,
  className,
}: WizardStepperProps) {
  return (
    <ol
      id="wizard-stepper"
      data-testid="wizard-stepper"
      className={cn(
        'grid grid-cols-2 gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm dark:border-gdc-border dark:bg-gdc-card sm:grid-cols-3 lg:grid-cols-5',
        className,
      )}
    >
      {wizardSteps.map((step, index) => {
        const active = index === stepIndex
        const status = completion[step.key]
        const reachable = wizardStepReachable(step.key, state, reachability)
        const tone =
          status === 'complete'
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : active
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-700 dark:text-violet-300'
              : status === 'in_progress'
                ? 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-slate-300 bg-white text-slate-500 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted'
        return (
          <li key={step.key} className="min-w-0">
            <button
              type="button"
              onClick={() => {
                if (!reachable) return
                setStepIndex(index)
              }}
              disabled={!reachable}
              title={
                !reachable ? 'Complete required steps before opening this section.' : undefined
              }
              className={cn(
                'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                active
                  ? 'border-violet-300 bg-violet-500/[0.08] dark:border-violet-500/40 dark:bg-violet-500/10'
                  : 'border-slate-200/80 bg-slate-50/70 hover:bg-slate-100/80 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
                !reachable && 'cursor-not-allowed opacity-60',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold">
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                    tone,
                  )}
                >
                  {status === 'complete' ? '✓' : index + 1}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[11px]',
                    active ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-gdc-mutedStrong',
                  )}
                >
                  {step.title}
                </span>
              </p>
              <p className="ml-5 mt-0.5 truncate text-[10px] font-medium text-slate-500 dark:text-gdc-muted">
                {step.subtitle}
              </p>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
