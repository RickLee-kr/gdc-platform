import { useEffect, useState } from 'react'
import { getAdminSystemInfo } from '../api/gdcAdmin'
import { formatAppEnvLabel, normalizeAppEnv } from './platform-environment'

export type PlatformEnvironmentState = {
  appEnv: string | null
  label: string
  loading: boolean
  failed: boolean
}

/**
 * Shared environment source for shell / danger confirms.
 * Uses the same `/admin/system` `app_env` as Administration footer.
 */
export function usePlatformEnvironment(): PlatformEnvironmentState {
  const [appEnv, setAppEnv] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const info = await getAdminSystemInfo()
        if (cancelled) return
        setAppEnv(normalizeAppEnv(info.app_env) || null)
        setFailed(false)
      } catch {
        if (!cancelled) {
          setAppEnv(null)
          setFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return {
    appEnv,
    label: failed && !appEnv ? 'Unknown environment' : formatAppEnvLabel(appEnv),
    loading,
    failed,
  }
}
