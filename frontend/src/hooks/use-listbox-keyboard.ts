import { useCallback, useState, type KeyboardEvent } from 'react'

/**
 * Shared ArrowUp/Down + Enter + Home/End navigation for combobox/listbox panels.
 * Returns the active index and a keydown handler for the search/trigger control.
 */
export function useListboxKeyboard(optionCount: number, onSelectIndex: (index: number) => void) {
  const [activeIndex, setActiveIndex] = useState(-1)

  const resetActive = useCallback(() => setActiveIndex(-1), [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (optionCount <= 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i < 0 ? 0 : Math.min(i + 1, optionCount - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i < 0 ? optionCount - 1 : Math.max(i - 1, 0)))
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setActiveIndex(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setActiveIndex(optionCount - 1)
        return
      }
      if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < optionCount) {
        e.preventDefault()
        onSelectIndex(activeIndex)
      }
    },
    [activeIndex, onSelectIndex, optionCount],
  )

  return { activeIndex, setActiveIndex, resetActive, onKeyDown }
}
