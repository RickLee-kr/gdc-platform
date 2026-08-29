import { X } from 'lucide-react'
import { StepDataProtection } from './step-data-protection'
import type { WizardDataProtectionState, WizardState } from './wizard-state'
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetPortal,
  SheetTitle,
} from '../../ui/sheet'

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
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetPortal>
        <SheetBackdrop data-testid="wizard-data-protection-drawer-backdrop" className="bg-black/30" />
        <SheetContent
          className="max-w-2xl border-slate-200 bg-white dark:border-gdc-border dark:bg-gdc-card"
          data-testid="wizard-data-protection-drawer"
        >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-gdc-border">
          <SheetTitle id="wizard-data-protection-drawer-title" className="text-sm text-slate-900 dark:text-slate-100">
            Data Protection
          </SheetTitle>
          <SheetClose
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
            aria-label="Close data protection editor"
            data-testid="wizard-data-protection-drawer-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <StepDataProtection state={state} onChange={onChange} />
        </div>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  )
}
