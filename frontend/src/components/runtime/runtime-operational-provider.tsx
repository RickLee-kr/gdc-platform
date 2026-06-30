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
import {
  stabilizeOperationalSnapshot,
  type StabilizedOperationalSnapshot,
} from '../../lib/snapshot-stabilize'
import { recordSnapshotRefreshRerender } from '../../lib/runtime-ui-instrumentation'

const REFRESH_MS: Record<RuntimeRefreshEvery, number> = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  off: 0,
}

export type RuntimeOperationalMeta = {
  loading: boolean
  error: string | null
  refresh: () => void
  lastUpdatedAt: string | null
  autoRefreshEnabled: boolean
  setAutoRefreshEnabled: (enabled: boolean) => void
  refreshEvery: RuntimeRefreshEvery
  setRefreshEvery: (value: RuntimeRefreshEvery) => void
}

export type RuntimeOperationalSnapshotState = {
  snapshot: StabilizedOperationalSnapshot | null
  streamsById: ReadonlyMap<number, import('../../api/operationalSnapshot').OperationalStreamSnapshot>
}

export type RuntimeOperationalContextValue = RuntimeOperationalMeta &
  RuntimeOperationalSnapshotState & {
    /** @deprecated Prefer stabilized snapshot from context; alias for compatibility. */
    snapshot: StabilizedOperationalSnapshot | null
  }

const RuntimeOperationalMetaContext = createContext<RuntimeOperationalMeta | null>(null)
const RuntimeOperationalSnapshotContext = createContext<RuntimeOperationalSnapshotState | null>(null)

const EMPTY_STREAMS_MAP = new Map<number, import('../../api/operationalSnapshot').OperationalStreamSnapshot>()

export function RuntimeOperationalProvider({ children }: { children: ReactNode }) {
  const [rawSnapshot, setRawSnapshot] = useState<OperationalSnapshotResponse | null>(null)
  const [snapshot, setSnapshot] = useState<StabilizedOperationalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshEvery, setRefreshEveryState] = useState<RuntimeRefreshEvery>('off')
  const [refreshTick, setRefreshTick] = useState(0)
  const loadGenerationRef = useRef(0)
  const loadInFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const wasHiddenRef = useRef(false)
  const snapshotRef = useRef<StabilizedOperationalSnapshot | null>(null)
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

  const applySnapshot = useCallback((data: OperationalSnapshotResponse) => {
    setRawSnapshot(data)
    setSnapshot((prev) => {
      const next = stabilizeOperationalSnapshot(prev, data)
      if (prev != null && next != null && prev !== next) {
        const changed: number[] = []
        for (let i = 0; i < next.streams.length; i++) {
          if (next.streams[i] !== prev.streams[i]) changed.push(next.streams[i]!.stream_id)
        }
        recordSnapshotRefreshRerender(changed)
      }
      return next
    })
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
            setRawSnapshot(null)
            setError('Could not load operational snapshot.')
          } else {
            setError('Could not refresh operational snapshot.')
          }
          return
        }
        applySnapshot(data)
        setError(null)
        logOperationalSnapshotRefresh(reason, data.updated_at)
      } catch (e) {
        if (!isCurrent()) return
        const message = e instanceof Error ? e.message : 'Failed to load operational snapshot.'
        if (showInitialLoader) {
          setSnapshot(null)
          setRawSnapshot(null)
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
    [refreshTick, applySnapshot],
  )

  useEffect(() => {
    void loadSnapshot(refreshTick === 0 ? 'mount' : 'refresh')
  }, [loadSnapshot])

  useEffect(() => {
    if (!documentVisible || !autoRefreshEnabled) return
    const ms = REFRESH_MS[refreshEvery]
    if (!ms) return
    const id = window.setInterval(() => {
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
      setRefreshTick((t) => t + 1)
    }
  }, [documentVisible])

  useEffect(() => {
    const onHeaderRefresh = () => refresh()
    window.addEventListener(GDC_HEADER_REFRESH_EVENT, onHeaderRefresh)
    return () => window.removeEventListener(GDC_HEADER_REFRESH_EVENT, onHeaderRefresh)
  }, [refresh])

  const metaValue = useMemo<RuntimeOperationalMeta>(
    () => ({
      loading,
      error,
      refresh,
      lastUpdatedAt: snapshot?.updated_at ?? rawSnapshot?.updated_at ?? null,
      autoRefreshEnabled,
      setAutoRefreshEnabled,
      refreshEvery,
      setRefreshEvery,
    }),
    [
      loading,
      error,
      refresh,
      snapshot?.updated_at,
      rawSnapshot?.updated_at,
      autoRefreshEnabled,
      setAutoRefreshEnabled,
      refreshEvery,
      setRefreshEvery,
    ],
  )

  const snapshotValue = useMemo<RuntimeOperationalSnapshotState>(
    () => ({
      snapshot,
      streamsById: snapshot?.streamsById ?? EMPTY_STREAMS_MAP,
    }),
    [snapshot],
  )

  const legacyValue = useMemo<RuntimeOperationalContextValue>(
    () => ({
      ...metaValue,
      ...snapshotValue,
    }),
    [metaValue, snapshotValue],
  )

  return (
    <RuntimeOperationalMetaContext.Provider value={metaValue}>
      <RuntimeOperationalSnapshotContext.Provider value={snapshotValue}>
        <RuntimeOperationalLegacyBridge value={legacyValue}>{children}</RuntimeOperationalLegacyBridge>
      </RuntimeOperationalSnapshotContext.Provider>
    </RuntimeOperationalMetaContext.Provider>
  )
}

const RuntimeOperationalLegacyContext = createContext<RuntimeOperationalContextValue | null>(null)

function RuntimeOperationalLegacyBridge({
  value,
  children,
}: {
  value: RuntimeOperationalContextValue
  children: ReactNode
}) {
  return <RuntimeOperationalLegacyContext.Provider value={value}>{children}</RuntimeOperationalLegacyContext.Provider>
}

export function useRuntimeOperationalMeta(): RuntimeOperationalMeta {
  const ctx = useContext(RuntimeOperationalMetaContext)
  if (ctx == null) throw new Error('useRuntimeOperationalMeta must be used within RuntimeOperationalProvider')
  return ctx
}

export function useRuntimeOperationalSnapshot(): RuntimeOperationalSnapshotState {
  const ctx = useContext(RuntimeOperationalSnapshotContext)
  if (ctx == null) throw new Error('useRuntimeOperationalSnapshot must be used within RuntimeOperationalProvider')
  return ctx
}

export function useRuntimeOperational(): RuntimeOperationalContextValue {
  const ctx = useContext(RuntimeOperationalLegacyContext)
  if (ctx == null) {
    throw new Error('useRuntimeOperational must be used within RuntimeOperationalProvider')
  }
  return ctx
}

/** Optional hook for tests or sections outside the provider tree. */
export function useRuntimeOperationalOptional(): RuntimeOperationalContextValue | null {
  return useContext(RuntimeOperationalLegacyContext)
}
