import { useEffect, useRef, type RefObject } from 'react'

/**
 * Returns an AbortController ref whose signal aborts on component unmount.
 * A fresh controller is created on each mount (Strict Mode safe).
 */
export function useMountAbortController(): RefObject<AbortController> {
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    return () => {
      controller.abort()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [])

  return controllerRef as RefObject<AbortController>
}

/** Convenience accessor for the mount-scoped abort signal (undefined until mount effect runs). */
export function useMountAbortSignal(): AbortSignal | undefined {
  const controllerRef = useMountAbortController()
  return controllerRef.current?.signal
}
