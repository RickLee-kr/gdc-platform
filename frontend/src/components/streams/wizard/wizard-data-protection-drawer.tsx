import { X } from 'lucide-react'
import { StepDataProtection } from './step-data-protection'
import type { WizardDataProtectionState, WizardState } from './wizard-state'

export type WizardDataProtectionDrawerProps = {
  open: boolean
  onClose: () => void
  state: WizardState
  onChange: (patch: Partial<WizardDataProtectionState>) => void
}

/** Full Data Protection editor — opened from Transform optional card. */
export function WizardDataProtectionDrawer({
  open,
  onClose,
  state,
  onChange,
}: WizardDataProtectionDrawerProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      data-testid="wizard-data-protection-drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl dark:border-gdc-border dark:bg-gdc-card"
        data-testid="wizard-data-protection-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-data-protection-drawer-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-gdc-border">
          <p id="wizard-data-protection-drawer-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Data Protection
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
            aria-label="Close data protection editor"
            data-testid="wizard-data-protection-drawer-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <StepDataProtection state={state} onChange={onChange} />
        </div>
      </aside>
    </div>
  )
}
