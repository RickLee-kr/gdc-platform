import { useEffect, useState } from 'react'
import { fetchStreamMappingUiConfig } from '../api/gdcRuntime'

/**
 * Loads `source_type` for numeric stream ids on the API test route so the app shell
 * breadcrumb/title can match the stream page without duplicating router state.
 */
export function useStreamSourceTypeForApiTestShell(streamId: string | undefined): string | null {
  const [sourceType, setSourceType] = useState<string | null>(null)

  useEffect(() => {
    setSourceType(null)
    if (!streamId || !/^\d+$/.test(streamId)) return

    let cancelled = false
    ;(async () => {
      try {
        const cfg = await fetchStreamMappingUiConfig(Number(streamId))
        if (cancelled || !cfg) return
        const raw = cfg.source_type
        setSourceType(typeof raw === 'string' && raw.trim() ? raw.trim() : null)
      } catch {
        if (!cancelled) setSourceType(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [streamId])

  return sourceType
}
