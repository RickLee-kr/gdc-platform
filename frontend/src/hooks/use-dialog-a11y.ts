import { useEffect, type RefObject } from 'react'

/** Focusable controls inside a dialog/drawer panel (excludes disabled / tabindex=-1). */
export function getDialogFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  return Array.from(nodes).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
}

export type UseDialogA11yOptions = {
  open: boolean
  onClose: () => void
  panelRef: RefObject<HTMLElement | null>
  /** When true, Escape does not close (e.g. busy confirm). */
  busy?: boolean
  /** Prefer focusing this selector inside the panel on open. */
  initialFocusSelector?: string
}

/**
 * Shared modal/drawer keyboard behavior:
 * - move focus into the panel on open
 * - trap Tab / Shift+Tab inside the panel
 * - close on Escape
 * - restore focus to the previously focused element on close
 */
export function useDialogA11y({
  open,
  onClose,
  panelRef,
  busy = false,
  initialFocusSelector,
}: UseDialogA11yOptions): void {
  useEffect(() => {
    if (!open) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = panel ? getDialogFocusable(panel) : []
    const initial =
      (initialFocusSelector
        ? focusables.find((el) => el.matches(initialFocusSelector))
        : undefined) ?? focusables[0]
    const timer = window.setTimeout(() => initial?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      previouslyFocused?.focus?.()
    }
  }, [open, panelRef, initialFocusSelector])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = getDialogFocusable(panelRef.current)
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panelRef.current.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose, panelRef])
}
