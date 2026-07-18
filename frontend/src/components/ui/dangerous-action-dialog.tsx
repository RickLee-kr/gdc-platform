import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDialogA11y } from '../../hooks/use-dialog-a11y'
import { cn } from '../../lib/utils'

export type DangerousActionDialogProps = {
  open: boolean
  title: string
  /** Short description of what will happen. */
  description?: ReactNode
  /** Bullet list of impact / side effects. */
  impactItems?: readonly string[]
  /** Deployment environment label shown in the dialog. */
  environmentLabel?: string
  confirmLabel?: string
  cancelLabel?: string
  /** When set, operator must type this exact string to enable confirm. */
  typedConfirmPhrase?: string
  typedConfirmHint?: string
  confirmTone?: 'danger' | 'warning'
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
  testId?: string
}

/**
 * Shared confirmation for High/Critical operator actions.
 * Critical actions should pass `typedConfirmPhrase`.
 */
export function DangerousActionDialog({
  open,
  title,
  description,
  impactItems,
  environmentLabel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  typedConfirmPhrase,
  typedConfirmHint,
  confirmTone = 'danger',
  busy = false,
  onCancel,
  onConfirm,
  testId = 'dangerous-action-dialog',
}: DangerousActionDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const typedLabelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const submitGuardRef = useRef(false)
  const [typed, setTyped] = useState('')

  const needsTyped = Boolean(typedConfirmPhrase?.trim())
  const typedOk = !needsTyped || typed.trim() === typedConfirmPhrase!.trim()
  const confirmDisabled = busy || !typedOk

  const tryConfirm = useCallback(() => {
    if (busy || !typedOk || submitGuardRef.current) return
    submitGuardRef.current = true
    onConfirm()
  }, [busy, typedOk, onConfirm])

  useEffect(() => {
    if (open) {
      setTyped('')
      submitGuardRef.current = false
    }
  }, [open])

  useEffect(() => {
    if (!busy) submitGuardRef.current = false
  }, [busy])

  useDialogA11y({
    open,
    onClose: onCancel,
    panelRef,
    busy,
    initialFocusSelector: needsTyped
      ? '[data-testid="dangerous-action-typed-confirm"]'
      : '[data-testid="dangerous-action-confirm"]',
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA') return
      if (target?.getAttribute('data-testid') === 'dangerous-action-cancel') return
      if (!confirmDisabled) {
        e.preventDefault()
        tryConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirmDisabled, tryConfirm])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-testid={testId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-gdc-border dark:bg-gdc-card"
      >
        <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h3>
        {environmentLabel ? (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="dangerous-action-environment">
            Environment: <span className="font-semibold text-slate-800 dark:text-slate-200">{environmentLabel}</span>
          </p>
        ) : null}
        {description ? (
          <div id={descriptionId} className="mt-2 text-[12px] text-slate-600 dark:text-gdc-muted">
            {description}
          </div>
        ) : null}
        {impactItems && impactItems.length > 0 ? (
          <ul className="mt-2 list-inside list-disc space-y-1 text-[12px] text-slate-600 dark:text-gdc-muted">
            {impactItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {needsTyped ? (
          <div className="mt-3">
            <label htmlFor={typedLabelId} className="text-[11px] text-slate-500 dark:text-gdc-muted">
              {typedConfirmHint ?? (
                <>
                  Type <span className="font-semibold text-slate-800 dark:text-slate-200">{typedConfirmPhrase}</span> to
                  confirm.
                </>
              )}
            </label>
            <input
              id={typedLabelId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-required="true"
              data-testid="dangerous-action-typed-confirm"
              className="mt-2 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
              autoComplete="off"
              disabled={busy}
            />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="dangerous-action-cancel"
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-700 disabled:opacity-50 dark:text-slate-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={tryConfirm}
            data-testid="dangerous-action-confirm"
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50',
              confirmTone === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700',
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
