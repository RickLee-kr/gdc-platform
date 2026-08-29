import { ShieldCheck } from 'lucide-react'
import { isGovernanceModeEnabled } from '../../../utils/governance-mode'
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from '../../ui/dialog'

type WizardGovernanceStartModalProps = {
  open: boolean
  governanceForStream: boolean
  onGovernanceForStreamChange: (enabled: boolean) => void
  onStart: () => void
  onCancel: () => void
}

export function WizardGovernanceStartModal({
  open,
  governanceForStream,
  onGovernanceForStreamChange,
  onStart,
  onCancel,
}: WizardGovernanceStartModalProps) {
  const tenantGov = isGovernanceModeEnabled()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogPortal>
        <DialogBackdrop className="bg-slate-900/40 backdrop-blur-[1px]" />
        <DialogContent
          className="w-full max-w-md rounded-xl border border-slate-200/90 bg-white p-5 shadow-xl dark:border-gdc-border dark:bg-gdc-card"
          data-testid="wizard-governance-start-modal"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-300">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle
                id="wizard-governance-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-50"
              >
                Enable data governance?
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-slate-600 dark:text-gdc-muted">
                Adds a Data Policy step with sensitive-data and response presets. Default is off for connector operators.
              </DialogDescription>
            </div>
          </div>

          {tenantGov ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200/90 p-3 dark:border-gdc-border">
              <input
                type="checkbox"
                className="mt-1"
                checked={governanceForStream}
                onChange={(e) => onGovernanceForStreamChange(e.target.checked)}
              />
              <div>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                  Enable data governance for this stream
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                  Recommended for regulated data. Adds Sensitive Data, Protection, Classification, and Response Action.
                </p>
              </div>
            </label>
          ) : (
            <p className="mt-4 rounded-md border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted">
              Tenant governance mode is off. Standard 4-step wizard will be used.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onStart}
              className="inline-flex h-9 items-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
            >
              Start Wizard
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
