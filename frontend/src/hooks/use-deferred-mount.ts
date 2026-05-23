import { useEffect, useState } from 'react'

/**
 * Defer mounting heavy UI until after first paint (requestIdleCallback) or a short timeout fallback.
 */
export function useDeferredMount(delayMs = 0): boolean {
  const immediate = delayMs <= 0 || import.meta.env.MODE === 'test'
  const [ready, setReady] = useState(immediate)

  useEffect(() => {
    if (immediate) {
      setReady(true)
      return
    }
    let cancelled = false
    const run = () => {
      if (!cancelled) setReady(true)
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: Math.max(delayMs, 120) })
      return () => {
        cancelled = true
        cancelIdleCallback(id)
      }
    }
    const t = window.setTimeout(run, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [delayMs, immediate])

  return ready
}
