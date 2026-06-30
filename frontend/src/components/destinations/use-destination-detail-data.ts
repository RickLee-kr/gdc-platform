import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchDestinationById,
  testDestination,
  type DestinationListItem,
  type DestinationRead,
} from '../../api/gdcDestinations'
import { fetchRouteFailuresAnalytics, fetchDeliveryOutcomesByDestination } from '../../api/gdcRuntimeAnalytics'
import { fetchDestinationHealthList, fetchRouteHealthList } from '../../api/gdcRuntimeHealth'
import { searchRuntimeDeliveryLogs } from '../../api/gdcRuntime'
import {
  getOperationalSnapshot,
  type OperationalDestinationSnapshot,
  type OperationalRouteSnapshot,
  type OperationalSnapshotResponse,
} from '../../api/operationalSnapshot'
import type {
  DestinationDeliveryOutcomeRow,
  DestinationHealthRow,
  RouteFailuresAnalyticsResponse,
  RouteHealthRow,
  RuntimeLogSearchItem,
} from '../../api/types/gdcApi'
import { isRequestAborted } from '../../lib/request-abort'
import {
  computeDestinationCurrentEps,
  computeDestinationSuccessRate,
  connectedStreamIdsFromRoutes,
  failureCountFromAnalytics,
  mapLogToDeliveryActivity,
  mapLogToRecentFailure,
  resolveDestinationUiHealth,
  routeMetricsFromHealthAndSnapshot,
  type DestinationUiHealth,
} from './destination-runtime-metrics'
import type { DestinationHealthState } from './destination-detail-model'

const RUNTIME_WINDOW = '24h' as const

export type DestinationDetailRuntimeBundle = {
  destination: DestinationRead | null
  listRow: DestinationListItem | null
  uiHealth: DestinationUiHealth
  healthState: DestinationHealthState
  connectedStreams: { streamId: number; streamName: string }[]
  connectedRoutes: {
    routeId: string
    routeName: string
    streamId: number
    streamName: string
    deliveryMode: string
    status: 'ACTIVE' | 'PAUSED' | 'ERROR'
    epsAvg: number
    successRate24h: number
  }[]
  successRatePct: number | null
  currentEps: number | null
  failed24h: number
  avgLatencyMs: number | null
  lastDeliveryAt: string | null
  lastErrorMessage: string | null
  recentActivity: ReturnType<typeof mapLogToDeliveryActivity>[]
  recentFailures: ReturnType<typeof mapLogToRecentFailure>[]
  routeHealthRows: RouteHealthRow[]
  failuresAnalytics: RouteFailuresAnalyticsResponse | null
  loading: boolean
  runtimeLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  runConnectivityTest: () => Promise<{ success: boolean; message: string }>
  testBusy: boolean
}

function healthStateFromUi(ui: DestinationUiHealth): DestinationHealthState {
  if (ui === 'Healthy') return 'HEALTHY'
  if (ui === 'Warning' || ui === 'Idle') return 'DEGRADED'
  if (ui === 'Critical') return 'ERROR'
  return 'DEGRADED'
}

function lastActivityIso(
  successAt: string | null | undefined,
  errorAt: string | null | undefined,
): string | null {
  if (!successAt && !errorAt) return null
  if (!successAt) return errorAt ?? null
  if (!errorAt) return successAt
  return Date.parse(successAt) >= Date.parse(errorAt) ? successAt : errorAt
}

function listRowFromSnapshot(
  detail: DestinationRead,
  scopedRoutes: OperationalRouteSnapshot[],
): DestinationListItem {
  return {
    ...detail,
    streams_using_count: new Set(scopedRoutes.map((r) => r.stream_id)).size,
    routes: scopedRoutes.map((r) => ({
      route_id: r.route_id,
      stream_id: r.stream_id,
      stream_name: r.stream_name?.trim() || `Stream #${r.stream_id}`,
      route_enabled: r.enabled,
      route_status: r.health_status,
    })),
  }
}

export function useDestinationDetailData(destinationId: number | null): DestinationDetailRuntimeBundle {
  const [destination, setDestination] = useState<DestinationRead | null>(null)
  const [listRow, setListRow] = useState<DestinationListItem | null>(null)
  const [snapshotDest, setSnapshotDest] = useState<OperationalDestinationSnapshot | null>(null)
  const [healthRow, setHealthRow] = useState<DestinationHealthRow | null>(null)
  const [outcomeRow, setOutcomeRow] = useState<DestinationDeliveryOutcomeRow | null>(null)
  const [routeHealthRows, setRouteHealthRows] = useState<RouteHealthRow[]>([])
  const [failuresAnalytics, setFailuresAnalytics] = useState<RouteFailuresAnalyticsResponse | null>(null)
  const [snapshotRoutes, setSnapshotRoutes] = useState<OperationalSnapshotResponse['routes']>([])
  const [recentLogs, setRecentLogs] = useState<RuntimeLogSearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)

  const load = useCallback(async () => {
    if (destinationId == null) {
      setLoading(false)
      setError('Invalid destination id.')
      return
    }
    setLoading(true)
    setRuntimeLoading(true)
    setError(null)
    try {
      const detail = await fetchDestinationById(destinationId)
      if (detail == null) {
        setError('Destination not found.')
        setDestination(null)
        setListRow(null)
        return
      }
      setDestination(detail)
      setListRow({
        ...detail,
        streams_using_count: 0,
        routes: [],
      })
      setLoading(false)

      const [snapshot, healthList, routeHealth, failures, outcomes, logs] = await Promise.allSettled([
        getOperationalSnapshot(),
        fetchDestinationHealthList({ destination_id: destinationId, window: RUNTIME_WINDOW }),
        fetchRouteHealthList({ destination_id: destinationId, window: RUNTIME_WINDOW }),
        fetchRouteFailuresAnalytics({ destination_id: destinationId, window: RUNTIME_WINDOW }),
        fetchDeliveryOutcomesByDestination({ window: RUNTIME_WINDOW }),
        searchRuntimeDeliveryLogs({
          destination_id: destinationId,
          window: RUNTIME_WINDOW,
          limit: 20,
        }),
      ])

      const snapshotVal = snapshot.status === 'fulfilled' ? snapshot.value : null
      const healthListVal = healthList.status === 'fulfilled' ? healthList.value : null
      const routeHealthVal = routeHealth.status === 'fulfilled' ? routeHealth.value : null
      const failuresVal = failures.status === 'fulfilled' ? failures.value : null
      const outcomesVal = outcomes.status === 'fulfilled' ? outcomes.value : null
      const logsVal = logs.status === 'fulfilled' ? logs.value : null

      const scopedRoutes = (snapshotVal?.routes ?? []).filter((r) => r.destination_id === destinationId)
      const row = listRowFromSnapshot(detail, scopedRoutes)
      const snapDest = snapshotVal?.destinations?.find((d) => d.destination_id === destinationId) ?? null
      const hRow =
        (healthListVal?.rows ?? []).find((x) => x.destination_id === destinationId) ??
        healthListVal?.rows?.[0] ??
        null
      const oRow = (outcomesVal?.rows ?? []).find((x) => x.destination_id === destinationId) ?? null

      setListRow(row)
      setSnapshotDest(snapDest)
      setHealthRow(hRow)
      setOutcomeRow(oRow)
      setRouteHealthRows(routeHealthVal?.rows ?? [])
      setFailuresAnalytics(failuresVal)
      setSnapshotRoutes(scopedRoutes)
      setRecentLogs(logsVal?.logs ?? [])

      if (snapshotVal == null && healthListVal == null && failuresVal == null && outcomesVal == null) {
        setError((prev) => prev ?? 'Runtime APIs unavailable for this destination.')
      }
    } catch (err) {
      if (!isRequestAborted(err)) {
        setError(err instanceof Error ? err.message : 'Failed to load destination detail.')
        setDestination(null)
        setListRow(null)
        setSnapshotDest(null)
        setHealthRow(null)
        setOutcomeRow(null)
        setRouteHealthRows([])
        setFailuresAnalytics(null)
        setSnapshotRoutes([])
        setRecentLogs([])
      }
    } finally {
      setLoading(false)
      setRuntimeLoading(false)
    }
  }, [destinationId])

  useEffect(() => {
    void load()
  }, [load])

  const runConnectivityTest = useCallback(async () => {
    if (destinationId == null) return { success: false, message: 'Invalid destination.' }
    setTestBusy(true)
    try {
      const result = await testDestination(destinationId)
      await load()
      return { success: result.success, message: result.message }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed.',
      }
    } finally {
      setTestBusy(false)
    }
  }, [destinationId, load])

  const routeHealthById = useMemo(() => {
    const m = new Map<number, RouteHealthRow>()
    for (const r of routeHealthRows) m.set(r.route_id, r)
    return m
  }, [routeHealthRows])

  const routeNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of listRow?.routes ?? []) {
      m.set(r.route_id, `Route #${r.route_id}`)
    }
    return m
  }, [listRow?.routes])

  const connectedRoutes = useMemo(() => {
    return (listRow?.routes ?? []).map((r) => {
      const metrics = routeMetricsFromHealthAndSnapshot(
        r.route_id,
        r.stream_name,
        r.stream_id,
        routeHealthById.get(r.route_id) ?? null,
        snapshotRoutes,
      )
      return {
        routeId: String(r.route_id),
        routeName: `Route #${r.route_id}`,
        streamId: r.stream_id,
        streamName: r.stream_name,
        deliveryMode: metrics.deliveryMode,
        status: r.route_enabled === false ? ('PAUSED' as const) : metrics.status,
        epsAvg: metrics.epsAvg,
        successRate24h: metrics.successRate24h,
      }
    })
  }, [listRow?.routes, routeHealthById, snapshotRoutes])

  const connectedStreams = useMemo(() => {
    const byId = new Map<number, string>()
    for (const r of listRow?.routes ?? []) {
      byId.set(r.stream_id, r.stream_name)
    }
    const ids = connectedStreamIdsFromRoutes(listRow?.routes ?? [])
    return ids.map((id) => ({
      streamId: id,
      streamName: byId.get(id) ?? `Stream #${id}`,
    }))
  }, [listRow?.routes])

  const uiHealth = useMemo(
    () => resolveDestinationUiHealth(destination?.enabled ?? true, snapshotDest, healthRow),
    [destination?.enabled, snapshotDest, healthRow],
  )

  const successRatePct = useMemo(
    () => computeDestinationSuccessRate(healthRow, outcomeRow, snapshotDest),
    [healthRow, outcomeRow, snapshotDest],
  )

  const currentEps = useMemo(() => computeDestinationCurrentEps(snapshotDest), [snapshotDest])

  const failed24h = useMemo(() => failureCountFromAnalytics(failuresAnalytics), [failuresAnalytics])

  const recentActivity = useMemo(
    () => recentLogs.slice(0, 8).map((log) => mapLogToDeliveryActivity(log, routeNameById)),
    [recentLogs, routeNameById],
  )

  const recentFailures = useMemo(
    () =>
      recentLogs
        .filter((log) => {
          const statusRaw = String(log.status ?? '').toUpperCase()
          return statusRaw.includes('FAIL') || log.level === 'ERROR'
        })
        .slice(0, 6)
        .map((log) => mapLogToRecentFailure(log, routeNameById)),
    [recentLogs, routeNameById],
  )

  const lastDeliveryAt = useMemo(
    () =>
      lastActivityIso(
        failuresAnalytics?.last_success_at ?? healthRow?.metrics.last_success_at ?? snapshotDest?.last_success_at,
        failuresAnalytics?.last_failure_at ?? healthRow?.metrics.last_failure_at ?? snapshotDest?.last_error_at,
      ),
    [failuresAnalytics, healthRow, snapshotDest],
  )

  const lastErrorMessage = snapshotDest?.last_error_message ?? null

  const avgLatencyMs =
    failuresAnalytics?.latency_ms_avg ?? healthRow?.metrics.latency_ms_avg ?? snapshotDest?.avg_latency_ms ?? null

  return {
    destination,
    listRow,
    uiHealth,
    healthState: healthStateFromUi(uiHealth),
    connectedStreams,
    connectedRoutes,
    successRatePct,
    currentEps,
    failed24h,
    avgLatencyMs,
    lastDeliveryAt,
    lastErrorMessage,
    recentActivity,
    recentFailures,
    routeHealthRows,
    failuresAnalytics,
    loading,
    runtimeLoading,
    error,
    refresh: load,
    runConnectivityTest,
    testBusy,
  }
}
