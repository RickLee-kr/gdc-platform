import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  clearOperationalSnapshotCache,
  getOperationalSnapshot,
  type OperationalSnapshotResponse,
} from '../../api/operationalSnapshot'
import { GDC_HEADER_REFRESH_EVENT } from '../layout/header-refresh-event'
import {
  loadRuntimeRefreshEvery,
  persistRuntimeRefreshEvery,
  type RuntimeRefreshEvery,
} from '../../localPreferences'
import { useDocumentVisible } from '../../hooks/use-document-visible'
import {
  logOperationalSnapshotRefresh,
  logOperationalSnapshotRefreshSuppressed,
  logOperationalSnapshotVisibility,
} from '../../lib/operational-snapshot-debug'

const REFRESH_MS: Record<RuntimeRefreshEvery, number> = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  off: 0,
}

export type RuntimeOperationalContextValue = {
  snapshot: OperationalSnapshotResponse | null
  loading: boolean
  error: string | null
  refresh: () => void
  lastUpdatedAt: string | null
  autoRefreshEnabled: boolean
  setAutoRefreshEnabled: (enabled: boolean) => void
  refreshEvery: RuntimeRefreshEvery
  setRefreshEvery: (value: RuntimeRefreshEvery) => void
}

const RuntimeOperationalContext = createContext<RuntimeOperationalContextValue | null>(null)

export function RuntimeOperationalProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<OperationalSnapshotResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshEvery, setRefreshEveryState] = useState<RuntimeRefreshEvery>('off')
  const [refreshTick, setRefreshTick] = useState(0)
  const loadGenerationRef = useRef(0)
  const loadInFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const wasHiddenRef = useRef(false)
  const snapshotRef = useRef<OperationalSnapshotResponse | null>(null)
  const documentVisible = useDocumentVisible()

  snapshotRef.current = snapshot

  useLayoutEffect(() => {
    setRefreshEveryState(loadRuntimeRefreshEvery())
  }, [])

  const autoRefreshEnabled = refreshEvery !== 'off'

  const setRefreshEvery = useCallback((value: RuntimeRefreshEvery) => {
    setRefreshEveryState(value)
    persistRuntimeRefreshEvery(value)
  }, [])

  const setAutoRefreshEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setRefreshEvery(refreshEvery === 'off' ? '30s' : refreshEvery)
      } else {
        setRefreshEvery('off')
      }
    },
    [refreshEvery, setRefreshEvery],
  )

  const refresh = useCallback(() => {
    clearOperationalSnapshotCache()
    setRefreshTick((t) => t + 1)
  }, [])

  const loadSnapshot = useCallback(
    async (reason: string) => {
      if (loadInFlightRef.current) {
        refreshQueuedRef.current = true
        logOperationalSnapshotRefreshSuppressed(`in-flight:${reason}`)
        return
      }
      loadInFlightRef.current = true
      const token = ++loadGenerationRef.current
      const isCurrent = () => token === loadGenerationRef.current
      const showInitialLoader = snapshotRef.current == null
      if (showInitialLoader) {
        setLoading(true)
        setError(null)
      }
      try {
        const data = await getOperationalSnapshot()
        if (!isCurrent()) return
        if (data == null) {
          if (showInitialLoader) {
            setSnapshot(null)
            setError('Could not load operational snapshot.')
          } else {
            setError('Could not refresh operational snapshot.')
          }
          return
        }
        setSnapshot(data)
        setError(null)
        logOperationalSnapshotRefresh(reason, data.updated_at)
      } catch (e) {
        if (!isCurrent()) return
        const message = e instanceof Error ? e.message : 'Failed to load operational snapshot.'
        if (showInitialLoader) {
          setSnapshot(null)
          setError(message)
        } else {
          setError(message)
        }
      } finally {
        if (isCurrent()) setLoading(false)
        loadInFlightRef.current = false
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false
          void loadSnapshot('queued')
        }
      }
    },
    [refreshTick],
  )

  useEffect(() => {
    void loadSnapshot(refreshTick === 0 ? 'mount' : 'refresh')
  }, [loadSnapshot])

  useEffect(() => {
    if (!documentVisible || !autoRefreshEnabled) return
    const ms = REFRESH_MS[refreshEvery]
    if (!ms) return
    const id = window.setInterval(() => {
      clearOperationalSnapshotCache()
      setRefreshTick((t) => t + 1)
    }, ms)
    return () => window.clearInterval(id)
  }, [refreshEvery, documentVisible, autoRefreshEnabled])

  useEffect(() => {
    logOperationalSnapshotVisibility(!documentVisible)
    if (!documentVisible) {
      wasHiddenRef.current = true
      return
    }
    if (wasHiddenRef.current) {
      wasHiddenRef.current = false
      clearOperationalSnapshotCache()
      setRefreshTick((t) => t + 1)
    }
  }, [documentVisible])

  useEffect(() => {
    const onHeaderRefresh = () => refresh()
    window.addEventListener(GDC_HEADER_REFRESH_EVENT, onHeaderRefresh)
    return () => window.removeEventListener(GDC_HEADER_REFRESH_EVENT, onHeaderRefresh)
  }, [refresh])

  const value = useMemo<RuntimeOperationalContextValue>(
    () => ({
      snapshot,
      loading,
      error,
      refresh,
      lastUpdatedAt: snapshot?.updated_at ?? null,
      autoRefreshEnabled,
      setAutoRefreshEnabled,
      refreshEvery,
      setRefreshEvery,
    }),
    [
      snapshot,
      loading,
      error,
      refresh,
      autoRefreshEnabled,
      setAutoRefreshEnabled,
      refreshEvery,
      setRefreshEvery,
    ],
  )

  return <RuntimeOperationalContext.Provider value={value}>{children}</RuntimeOperationalContext.Provider>
}

export function useRuntimeOperational(): RuntimeOperationalContextValue {
  const ctx = useContext(RuntimeOperationalContext)
  if (ctx == null) {
    throw new Error('useRuntimeOperational must be used within RuntimeOperationalProvider')
  }
  return ctx
}

/** Optional hook for tests or sections outside the provider tree. */
export function useRuntimeOperationalOptional(): RuntimeOperationalContextValue | null {
  return useContext(RuntimeOperationalContext)
}
