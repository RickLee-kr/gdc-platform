import { useEffect, useState } from 'react'

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'))

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return visible
}
