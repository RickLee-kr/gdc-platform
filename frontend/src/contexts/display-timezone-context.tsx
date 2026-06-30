import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getAuthMe, patchAuthProfile, type WhoAmIDto } from '../api/gdcAdmin'
import { getAdminDisplaySettings, putAdminDisplaySettings } from '../api/gdcAdmin'
import { setDisplayTimezoneCache } from '../lib/display-timezone-cache'
import {
  formatPlatformRelative,
  formatPlatformTimestamp,
  resolveDisplayTimezone,
  type FormatPlatformTimestampOptions,
} from '../lib/platform-timestamps'
import { readSession } from '../auth/session'

export type DisplayTimezoneContextValue = {
  timezone: string
  userTimezone: string | null
  platformDefaultTimezone: string
  loading: boolean
  refresh: () => Promise<void>
  setUserTimezone: (tz: string | null) => Promise<void>
  setPlatformDefaultTimezone: (tz: string) => Promise<void>
  formatTimestamp: (iso: string | null | undefined, options?: FormatPlatformTimestampOptions) => string
  formatRelative: (iso: string | null | undefined) => string
}

const DisplayTimezoneContext = createContext<DisplayTimezoneContextValue | null>(null)

function applyWhoAmI(who: WhoAmIDto): { userTimezone: string | null; platformDefaultTimezone: string } {
  const userTimezone = who.timezone?.trim() ? who.timezone.trim() : null
  const platformDefaultTimezone = who.platform_default_timezone?.trim() || 'UTC'
  setDisplayTimezoneCache({ userTimezone, platformDefaultTimezone })
  return { userTimezone, platformDefaultTimezone }
}

export function DisplayTimezoneProvider({ children }: { children: ReactNode }) {
  const [userTimezone, setUserTimezoneState] = useState<string | null>(null)
  const [platformDefaultTimezone, setPlatformDefaultTimezoneState] = useState('UTC')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!readSession()) {
      setLoading(false)
      return
    }
    try {
      const who = await getAuthMe()
      const applied = applyWhoAmI(who)
      setUserTimezoneState(applied.userTimezone)
      setPlatformDefaultTimezoneState(applied.platformDefaultTimezone)
    } catch {
      /* keep prior cache */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const timezone = useMemo(
    () =>
      resolveDisplayTimezone({
        userTimezone,
        platformDefaultTimezone,
      }),
    [userTimezone, platformDefaultTimezone],
  )

  const formatTimestamp = useCallback(
    (iso: string | null | undefined, options?: FormatPlatformTimestampOptions) =>
      formatPlatformTimestamp(iso, timezone, options),
    [timezone],
  )

  const formatRelative = useCallback(
    (iso: string | null | undefined) => formatPlatformRelative(iso),
    [],
  )

  const setUserTimezone = useCallback(
    async (tz: string | null) => {
      const who = await patchAuthProfile({ timezone: tz })
      const applied = applyWhoAmI(who)
      setUserTimezoneState(applied.userTimezone)
      setPlatformDefaultTimezoneState(applied.platformDefaultTimezone)
    },
    [],
  )

  const setPlatformDefaultTimezone = useCallback(async (tz: string) => {
    const row = await putAdminDisplaySettings({ default_timezone: tz })
    const next = row.default_timezone?.trim() || 'UTC'
    setPlatformDefaultTimezoneState(next)
    setDisplayTimezoneCache({ platformDefaultTimezone: next })
  }, [])

  const value = useMemo<DisplayTimezoneContextValue>(
    () => ({
      timezone,
      userTimezone,
      platformDefaultTimezone,
      loading,
      refresh,
      setUserTimezone,
      setPlatformDefaultTimezone,
      formatTimestamp,
      formatRelative,
    }),
    [
      timezone,
      userTimezone,
      platformDefaultTimezone,
      loading,
      refresh,
      setUserTimezone,
      setPlatformDefaultTimezone,
      formatTimestamp,
      formatRelative,
    ],
  )

  return <DisplayTimezoneContext.Provider value={value}>{children}</DisplayTimezoneContext.Provider>
}

export function useDisplayTimezone(): DisplayTimezoneContextValue {
  const ctx = useContext(DisplayTimezoneContext)
  if (!ctx) {
    throw new Error('useDisplayTimezone must be used within DisplayTimezoneProvider')
  }
  return ctx
}

/** Safe hook for modules outside the provider tree (falls back to browser/UTC). */
export function useDisplayTimezoneOptional(): DisplayTimezoneContextValue | null {
  return useContext(DisplayTimezoneContext)
}

export async function loadPlatformDefaultTimezoneForAdmin(): Promise<string> {
  const row = await getAdminDisplaySettings()
  return row.default_timezone?.trim() || 'UTC'
}
