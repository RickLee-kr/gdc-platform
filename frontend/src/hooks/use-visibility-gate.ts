import { useEffect, useRef, useState } from 'react'

export function useVisibilityGate<T extends HTMLElement>(options: IntersectionObserverInit = {}) {
  const ref = useRef<T | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [hasBeenVisible, setHasBeenVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (node == null) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      setHasBeenVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextVisible = entry?.isIntersecting === true
        setIsVisible(nextVisible)
        if (nextVisible) setHasBeenVisible(true)
      },
      { rootMargin: '160px 0px', threshold: 0.01, ...options },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [options.root, options.rootMargin, options.threshold])

  return { ref, isVisible, hasBeenVisible }
}
