import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG_CONNECTORS_LIST_KEY } from '../api/catalogListCache'
import {
  CONNECTORS_LIST_LOAD_FAILED_MESSAGE,
  fetchConnectorsListResult,
  GDC_AUTH_REQUIRED_MESSAGE,
  normalizeConnectorsLoadError,
  type ConnectorRead,
} from '../api/gdcConnectors'
import {
  fetchConnectorOperationsSummary,
  type ConnectorOperationsRow,
} from '../api/gdcConnectorsOperations'
import { fetchStreamsList } from '../api/gdcStreams'
import { clearSharedRequestCache } from '../api/requestCache'
import { useMountAbortController } from '../hooks/use-mount-abort-signal'
import { isRequestAborted } from '../lib/request-abort'
import {
  buildConnectorDashboardRow,
  compareConnectorsProblemFirst,
  type ConnectorDashboardRow,
} from '../lib/connector-operational-health'

export const CONNECTORS_SLOW_LOADING_MS = 5_000
export const CONNECTORS_RETRY_BUTTON_MS = 15_000

const CONNECTORS_LIST_CACHE_NS = 'catalog-connectors'

export type ConnectorsOverviewData = {
  rows: ConnectorDashboardRow[]
  loading: boolean
  refreshing: boolean
  slowLoading: boolean
  showRetry: boolean
  error: string | null
  refreshError: string | null
  usingStaleData: boolean
  authRequired: boolean
  apiBacked: boolean
  supplementaryError: string | null
  operationsBacked: boolean
  reload: (options?: { bustCache?: boolean }) => void
  patchConnector: (connectorId: number, patch: Partial<ConnectorRead>) => void
}

function enrichStreamCountsFromStreams(
  connectors: ConnectorRead[],
  streams: NonNullable<Awaited<ReturnType<typeof fetchStreamsList>>>,
): ConnectorRead[] {
  const counts = new Map<number, number>()
  for (const stream of streams) {
    const connectorId = Number(stream.connector_id ?? 0)
    if (connectorId > 0) {
      counts.set(connectorId, (counts.get(connectorId) ?? 0) + 1)
    }
  }
  return connectors.map((connector) => ({
    ...connector,
    stream_count: counts.has(connector.id) ? (counts.get(connector.id) ?? connector.stream_count) : connector.stream_count,
  }))
}

function operationsMap(rows: ConnectorOperationsRow[] | undefined): Map<number, ConnectorOperationsRow> {
  const out = new Map<number, ConnectorOperationsRow>()
  for (const row of rows ?? []) {
    out.set(row.connector_id, row)
  }
  return out
}

export function useConnectorsOverviewData(): ConnectorsOverviewData {
  const abortRef = useMountAbortController()
  const [baseRows, setBaseRows] = useState<ConnectorRead[]>([])
  const [opsById, setOpsById] = useState<Map<number, ConnectorOperationsRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [slowLoading, setSlowLoading] = useState(false)
  const [showRetry, setShowRetry] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [usingStaleData, setUsingStaleData] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [apiBacked, setApiBacked] = useState(true)
  const [operationsBacked, setOperationsBacked] = useState(false)
  const [supplementaryError, setSupplementaryError] = useState<string | null>(null)

  const loadGenRef = useRef(0)
  const baseRowsRef = useRef(baseRows)
  baseRowsRef.current = baseRows
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearTimers = useCallback(() => {
    if (slowTimerRef.current != null) {
      clearTimeout(slowTimerRef.current)
      slowTimerRef.current = undefined
    }
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = undefined
    }
  }, [])

  const load = useCallback(
    async (options?: { bustCache?: boolean }) => {
      const gen = ++loadGenRef.current
      const isCurrent = () => loadGenRef.current === gen
      const hadRows = baseRowsRef.current.length > 0

      setLoading(true)
      setSlowLoading(false)
      setShowRetry(false)
      setError(null)
      setRefreshError(null)
      setUsingStaleData(false)
      setAuthRequired(false)
      setSupplementaryError(null)
      clearTimers()

      slowTimerRef.current = setTimeout(() => {
        if (isCurrent()) setSlowLoading(true)
      }, CONNECTORS_SLOW_LOADING_MS)

      retryTimerRef.current = setTimeout(() => {
        if (isCurrent()) setShowRetry(true)
      }, CONNECTORS_RETRY_BUTTON_MS)

      if (options?.bustCache) {
        clearSharedRequestCache(CONNECTORS_LIST_CACHE_NS, CATALOG_CONNECTORS_LIST_KEY)
      }

      try {
        const fetchOpts = { signal: abortRef.current?.signal }
        const listResult = await fetchConnectorsListResult(fetchOpts)
        if (!isCurrent()) return

        if (listResult.ok === false) {
          setApiBacked(false)
          setOperationsBacked(false)
          setAuthRequired(listResult.authRequired)
          const message = listResult.authRequired
            ? GDC_AUTH_REQUIRED_MESSAGE
            : normalizeConnectorsLoadError(listResult.message)
          if (hadRows) {
            setUsingStaleData(true)
            setRefreshError(message)
            setError(null)
          } else {
            setUsingStaleData(false)
            setRefreshError(null)
            setError(message)
            setBaseRows([])
            setOpsById(new Map())
          }
          return
        }

        const list = listResult.data ?? []
        setApiBacked(true)
        setUsingStaleData(false)
        setRefreshError(null)
        setError(null)
        setBaseRows(list)

        void fetchStreamsList(fetchOpts)
          .then((streams) => {
            if (!isCurrent() || streams == null) return
            setBaseRows((prev) => enrichStreamCountsFromStreams(prev, streams))
          })
          .catch((e) => {
            if (!isCurrent() || isRequestAborted(e)) return
            setSupplementaryError(e instanceof Error ? e.message : String(e))
          })

        void fetchConnectorOperationsSummary('1h', fetchOpts)
          .then((summary) => {
            if (!isCurrent()) return
            if (summary?.connectors) {
              setOperationsBacked(true)
              setOpsById(operationsMap(summary.connectors))
            }
          })
          .catch((e) => {
            if (!isCurrent() || isRequestAborted(e)) return
            setOperationsBacked(false)
          })
      } catch (e) {
        if (!isCurrent() || isRequestAborted(e)) return
        setApiBacked(false)
        setOperationsBacked(false)
        const message = normalizeConnectorsLoadError(e instanceof Error ? e.message : String(e))
        if (hadRows) {
          setUsingStaleData(true)
          setRefreshError(message)
          setError(null)
        } else {
          setUsingStaleData(false)
          setRefreshError(null)
          setError(message || CONNECTORS_LIST_LOAD_FAILED_MESSAGE)
          setBaseRows([])
          setOpsById(new Map())
        }
      } finally {
        if (isCurrent()) {
          setLoading(false)
          clearTimers()
          setSlowLoading(false)
        }
      }
    },
    [clearTimers, abortRef],
  )

  useEffect(() => {
    void load()
    return () => {
      loadGenRef.current += 1
      clearTimers()
    }
  }, [load, clearTimers])

  const reload = useCallback(
    (options?: { bustCache?: boolean }) => {
      void load(options)
    },
    [load],
  )

  const patchConnector = useCallback((connectorId: number, patch: Partial<ConnectorRead>) => {
    setBaseRows((prev) => prev.map((row) => (row.id === connectorId ? { ...row, ...patch } : row)))
  }, [])

  const rows = useMemo(() => {
    const mapped = baseRows.map((row) => buildConnectorDashboardRow(row, opsById))
    return [...mapped].sort((a, b) =>
      compareConnectorsProblemFirst({ health: a.health, name: a.name }, { health: b.health, name: b.name }),
    )
  }, [baseRows, opsById])

  const refreshing = loading && baseRows.length > 0

  return {
    rows,
    loading,
    refreshing,
    slowLoading,
    showRetry,
    error,
    refreshError,
    usingStaleData,
    authRequired,
    apiBacked,
    supplementaryError,
    operationsBacked,
    reload,
    patchConnector,
  }
}
