import { useCallback, useState } from 'react'

/**
 * Pair of editable string vs server/sync baseline for dirty detection.
 * syncBoth updates both (after successful load or save).
 */
export function useDirtyPair(initialCurrent = '', initialBaseline?: string) {
  const [current, setCurrent] = useState(initialCurrent)
  const [baseline, setBaseline] = useState(initialBaseline ?? initialCurrent)

  const syncBoth = useCallback((next: string) => {
    setCurrent(next)
    setBaseline(next)
  }, [])

  const isDirty = current !== baseline

  return { current, baseline, setCurrent, setBaseline, syncBoth, isDirty }
}
