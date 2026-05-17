import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  Square,
  X,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../../lib/utils'
import {
  fetchRuntimeAlertSummary,
  fetchRuntimeDashboardSummary,
  fetchRuntimeLogsPage,
  fetchRuntimeSystemResources,
  fetchRuntimeStatus,
  fetchStreamRuntimeMetrics,
  fetchStreamRuntimeStats,
  fetchStreamRuntimeStatsHealth,
  runStreamOnce,
  startRuntimeStream,
  stopRuntimeStream,
  type MetricsWindow,
} from '../../api/gdcRuntime'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { fetchStreamsListResult, GDC_AUTH_REQUIRED_MESSAGE } from '../../api/gdcStreams'
import {
  enrichStreamRowWithRuntime,
  mergeConnectorLabelIntoRow,
  streamReadToConsoleRow,
  type StreamConsoleRow,
  type StreamRuntimeStatus,
} from '../../api/streamRows'
import type {
  DashboardSummaryResponse,
  RouteRuntimeMetricsRow,
  RuntimeAlertSummaryItem,
  RuntimeLogsPageItem,
  RuntimeSystemResourcesResponse,
  StreamRuntimeMetricsResponse,
  StreamRuntimeStatsResponse,
  RuntimeStatusResponse,
} from '../../api/types/gdcApi'
import {
  enrichSubsetMeta,
  formatCoverageRatio,
  visualizationSummary,
} from '../../api/visualizationMeta'
import { createRuntimeSnapshotId, snapshotMatches } from '../../api/runtimeSnapshotSync'
import { fetchBackfillJobs } from '../../api/gdcBackfill'
import { fetchRouteById, fetchRoutesList } from '../../api/gdcRoutes'
import {
  NAV_PATH,
  logsExplorerPath,
  logsPath,
  newStreamPath,
  streamEditPath,
  streamRuntimePath,
} from '../../config/nav-paths'
import { GDC_HEADER_REFRESH_EVENT } from '../layout/header-refresh-event'
import { StatusBadge, type StatusTone } from '../shell/status-badge'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import {
  buildMonitoringKpis,
  donutFromTopStreams,
  formatCompactInt,
  mergeEventsOverTime,
  statusCounts,
  topStreamsByMetric,
  type MonitoringKpi,
} from './runtime-monitoring-aggregates'
import { RuntimeRetentionSection } from './RuntimeRetentionSection'
import { MigrationIntegrityPanel } from './migration-integrity-panel'
import {
  loadRuntimeRefreshEvery,
  persistRuntimeRefreshEvery,
  type RuntimeRefreshEvery,
} from '../../localPreferences'

const REFRESH_MS: Record<string, number | 0> = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  off: 0,
}

const PIE_COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626']

type StatusTab = 'all' | 'normal' | 'warning' | 'error' | 'stopped'

function MiniSparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 48
  const h = 16
  const nums = values.length ? [...values] : [0]
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const points = nums
    .map((value, index) => {
      const x = (index / Math.max(nums.length - 1, 1)) * w
      const y = h - ((value - min) / range) * h
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  )
}

function toneClass(tone: MonitoringKpi['tone']): string {
  switch (tone) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'text-amber-600 dark:text-amber-400'
    case 'error':
      return 'text-red-600 dark:text-red-400'
    case 'violet':
      return 'text-violet-600 dark:text-violet-400'
    default:
      return 'text-slate-500 dark:text-gdc-muted'
  }
}

function uiStatusTone(s: StreamRuntimeStatus): StatusTone {
  switch (s) {
    case 'RUNNING':
      return 'success'
    case 'DEGRADED':
      return 'warning'
    case 'ERROR':
      return 'error'
    case 'STOPPED':
      return 'neutral'
    case 'UNKNOWN':
      return 'neutral'
    default: {
      const _x: never = s
      return _x
    }
  }
}

function statusLabelEn(s: StreamRuntimeStatus): string {
  switch (s) {
    case 'RUNNING':
      return 'Healthy'
    case 'DEGRADED':
      return 'Warning'
    case 'ERROR':
      return 'Error'
    case 'STOPPED':
      return 'Stopped'
    case 'UNKNOWN':
      return 'Unknown'
    default: {
      const _x: never = s
      return _x
    }
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${Math.round(n)} B`
}

function rowMatchesTab(row: StreamConsoleRow, tab: StatusTab): boolean {
  if (tab === 'all') return true
  if (tab === 'normal') return row.status === 'RUNNING'
  if (tab === 'warning') return row.status === 'DEGRADED'
  if (tab === 'error') return row.status === 'ERROR'
  return row.status === 'STOPPED' || row.status === 'UNKNOWN'
}

function formatShortTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  return String(iso).slice(0, 19).replace('T', ' ')
}

function summarizeRouteRuntimeConnectivity(routeRuntime: RouteRuntimeMetricsRow[] | undefined): string {
  if (!routeRuntime?.length) return '—'
  let unreachable = 0
  let degraded = 0
  let retryHeavy = 0
  for (const r of routeRuntime) {
    if (r.connectivity_state === 'ERROR') unreachable += 1
    else if (r.connectivity_state === 'DEGRADED') degraded += 1
    const rc = typeof r.retry_count_last_hour === 'number' && Number.isFinite(r.retry_count_last_hour) ? r.retry_count_last_hour : 0
    if (rc >= 5) retryHeavy += 1
  }
  const parts: string[] = []
  if (unreachable) parts.push(`${unreachable} unreachable`)
  if (degraded) parts.push(`${degraded} degraded`)
  if (retryHeavy) parts.push(`${retryHeavy} retry-heavy`)
  return parts.length ? parts.join(' · ') : 'OK'
}

type UrlRuntimeResolveError = 'route_not_found' | 'stream_mismatch' | 'no_route_for_destination'

export function RuntimeOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const queryStreamId = useMemo(() => {
    const v = searchParams.get('stream_id')
    return v && /^\d+$/.test(v) ? Number(v) : undefined
  }, [searchParams])

  const queryRouteId = useMemo(() => {
    const v = searchParams.get('route_id')
    return v && /^\d+$/.test(v) ? Number(v) : undefined
  }, [searchParams])

  const queryDestinationId = useMemo(() => {
    const v = searchParams.get('destination_id')
    return v && /^\d+$/.test(v) ? Number(v) : undefined
  }, [searchParams])

  const urlFilterSignature = useMemo(
    () =>
      [searchParams.get('stream_id'), searchParams.get('route_id'), searchParams.get('destination_id')].join('|'),
    [searchParams],
  )

  const hasUrlFilters = queryStreamId != null || queryRouteId != null || queryDestinationId != null

  const [urlResolveBusy, setUrlResolveBusy] = useState(false)
  const [urlResolved, setUrlResolved] = useState<{
    effectiveStreamId: number | null
    highlightRouteId: number | null
    highlightDestinationId: number | null
    error: UrlRuntimeResolveError | null
  }>({
    effectiveStreamId: null,
    highlightRouteId: null,
    highlightDestinationId: null,
    error: null,
  })

  const [dash, setDash] = useState<DashboardSummaryResponse | null>(null)
  const [startupStatus, setStartupStatus] = useState<RuntimeStatusResponse | null>(null)
  const [rows, setRows] = useState<StreamConsoleRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const [metricsByStream, setMetricsByStream] = useState<Map<number, StreamRuntimeMetricsResponse>>(new Map())
  /** Streams whose table row is expanded to trigger lazy per-stream metrics (excludes selection; detail panel owns that fetch). */
  const [expandedStreamIds, setExpandedStreamIds] = useState<number[]>([])
  const [rowMetricsInlineLoading, setRowMetricsInlineLoading] = useState<Record<number, boolean>>({})

  const [recentLogs, setRecentLogs] = useState<RuntimeLogsPageItem[] | null>(null)
  const [alertItems, setAlertItems] = useState<RuntimeAlertSummaryItem[]>([])
  const [sysRes, setSysRes] = useState<RuntimeSystemResourcesResponse | null>(null)
  const [backfillByStream, setBackfillByStream] = useState<Map<number, string>>(new Map())

  const [timeRange, setTimeRange] = useState<MetricsWindow>('1h')
  const lastTimeRangeForMetricsClearRef = useRef<MetricsWindow>(timeRange)
  const [refreshEvery, setRefreshEvery] = useState<RuntimeRefreshEvery>('off')
  useLayoutEffect(() => {
    setRefreshEvery(loadRuntimeRefreshEvery())
  }, [])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [page, setPage] = useState(1)
  const pageSize = 8

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailStats, setDetailStats] = useState<StreamRuntimeStatsResponse | null>(null)
  const [detailMetrics, setDetailMetrics] = useState<StreamRuntimeMetricsResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [controlBusy, setControlBusy] = useState(false)
  const [runOnceBusy, setRunOnceBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!hasUrlFilters) {
      setUrlResolveBusy(false)
      setUrlResolved({
        effectiveStreamId: null,
        highlightRouteId: null,
        highlightDestinationId: null,
        error: null,
      })
      return
    }

    setUrlResolveBusy(true)
    ;(async () => {
      try {
        const highlightRouteId = queryRouteId ?? null
        const highlightDestinationId = queryDestinationId ?? null
        let effectiveStreamId: number | null = queryStreamId ?? null
        let error: UrlRuntimeResolveError | null = null

        if (queryRouteId != null) {
          const route = await fetchRouteById(queryRouteId)
          if (cancelled) return
          if (route?.stream_id == null || !Number.isFinite(route.stream_id)) {
            setUrlResolved({
              effectiveStreamId: null,
              highlightRouteId,
              highlightDestinationId,
              error: 'route_not_found',
            })
            return
          }
          if (queryStreamId != null && route.stream_id !== queryStreamId) {
            setUrlResolved({
              effectiveStreamId: null,
              highlightRouteId,
              highlightDestinationId,
              error: 'stream_mismatch',
            })
            return
          }
          effectiveStreamId = route.stream_id
        }

        if (effectiveStreamId == null && queryDestinationId != null) {
          const routes = await fetchRoutesList()
          if (cancelled) return
          const match = routes?.find((r) => r.destination_id === queryDestinationId)
          if (match?.stream_id == null || !Number.isFinite(match.stream_id)) {
            setUrlResolved({
              effectiveStreamId: null,
              highlightRouteId,
              highlightDestinationId,
              error: 'no_route_for_destination',
            })
            return
          }
          effectiveStreamId = match.stream_id
        }

        if (cancelled) return
        setUrlResolved({
          effectiveStreamId,
          highlightRouteId,
          highlightDestinationId,
          error,
        })
      } finally {
        if (!cancelled) setUrlResolveBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hasUrlFilters, queryStreamId, queryRouteId, queryDestinationId])

  const rowIdsSignature = useMemo(() => rows.map((r) => r.id).join(','), [rows])

  const removeRuntimeUrlParam = useCallback(
    (key: 'stream_id' | 'route_id' | 'destination_id') => {
      const next = new URLSearchParams(searchParams)
      next.delete(key)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const loadAll = useCallback(async () => {
    setLoadError(null)
    setAuthRequired(false)
    setLoading(true)
    try {
      const snapshot_id = createRuntimeSnapshotId()
      if (lastTimeRangeForMetricsClearRef.current !== timeRange) {
        lastTimeRangeForMetricsClearRef.current = timeRange
        setMetricsByStream(new Map())
      }

      const [dashRes, listResult, startupSnap] = await Promise.all([
        fetchRuntimeDashboardSummary(100, timeRange, { snapshot_id }),
        fetchStreamsListResult(),
        fetchRuntimeStatus(),
      ])
      setStartupStatus(startupSnap ?? null)
      if (!snapshotMatches(snapshot_id, dashRes)) return
      if (dashRes) setDash(dashRes)

      if (listResult.ok === false) {
        setAuthRequired(listResult.authRequired)
        setLoadError(listResult.message)
        setRows([])
        setMetricsByStream(new Map())
        setSelectedId(null)
        setBackfillByStream(new Map())
        return
      }

      const streamList = listResult.data

      if (!streamList.length) {
        setRows([])
        setMetricsByStream(new Map())
        setSelectedId(null)
        setBackfillByStream(new Map())
        return
      }

      const connectorById = new Map<number, string>()
      const connectorIds = [...new Set(streamList.map((s) => s.connector_id).filter((x): x is number => typeof x === 'number'))]
      await Promise.all(
        connectorIds.map(async (cid) => {
          try {
            const c = await fetchConnectorById(cid)
            const nm = (c?.name ?? '').trim()
            if (nm) connectorById.set(cid, nm)
          } catch {
            /* Connector label failure must not block stream list */
          }
        }),
      )

      const baseRows = streamList.map((s) => {
        let row = streamReadToConsoleRow(s)
        const connLabel = s.connector_id != null ? connectorById.get(s.connector_id) : undefined
        row = mergeConnectorLabelIntoRow(row, connLabel ?? null)
        return row
      })

      setRows(baseRows)
      setLoading(false)
      setSelectedId((prev) => {
        const ids = new Set(baseRows.map((r) => r.id))
        if (prev && ids.has(prev)) return prev
        return baseRows[0]?.id ?? null
      })

      const rtChunk = 8
      const enrichedRows: StreamConsoleRow[] = []
      for (let i = 0; i < baseRows.length; i += rtChunk) {
        const slice = baseRows.slice(i, i + rtChunk)
        const part = await Promise.all(
          slice.map(async (row) => {
            const sid = Number(row.id)
            if (!Number.isFinite(sid) || !/^\d+$/.test(row.id)) {
              return { ...row, runtimeStatsAttempted: true, hasRuntimeApiSnapshot: false }
            }
            try {
              const bundle = await fetchStreamRuntimeStatsHealth(sid, 80)
              const stats = bundle?.stats ?? null
              const health = bundle?.health ?? null
              return enrichStreamRowWithRuntime(row, stats, health)
            } catch {
              return { ...row, runtimeStatsAttempted: true, hasRuntimeApiSnapshot: false }
            }
          }),
        )
        enrichedRows.push(...part)
      }

      setRows(enrichedRows)

      const [logPage, alertRes, sys] = await Promise.all([
        fetchRuntimeLogsPage({ limit: 35, window: timeRange, snapshot_id }),
        fetchRuntimeAlertSummary(timeRange, 80),
        fetchRuntimeSystemResources(),
      ])
      if (!snapshotMatches(snapshot_id, logPage)) return
      if (logPage?.items?.length) {
        setRecentLogs(logPage.items)
      } else {
        setRecentLogs(null)
      }
      if (alertRes?.items?.length) {
        setAlertItems(alertRes.items.slice(0, 12))
      } else {
        setAlertItems([])
      }
      setSysRes(sys ?? null)

      let bfMap = new Map<number, string>()
      try {
        const jobs = await fetchBackfillJobs(80)
        if (jobs?.length) {
          for (const j of jobs) {
            const st = (j.status ?? '').toUpperCase()
            if (st === 'RUNNING' || st === 'PENDING' || st === 'CANCELLING') {
              if (!bfMap.has(j.stream_id)) {
                bfMap.set(j.stream_id, st === 'RUNNING' ? 'Running' : st === 'CANCELLING' ? 'Cancelling' : 'Queued')
              }
            }
          }
        }
      } catch {
        bfMap = new Map()
      }
      setBackfillByStream(bfMap)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load runtime data.'
      setAuthRequired(false)
      setLoadError(msg)
      setRows([])
      setMetricsByStream(new Map())
      setBackfillByStream(new Map())
      setStartupStatus(null)
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  useEffect(() => {
    void loadAll()
  }, [loadAll, refreshToken])

  useEffect(() => {
    const ms = REFRESH_MS[refreshEvery]
    if (!ms) return
    const id = window.setInterval(() => setRefreshToken((t) => t + 1), ms)
    return () => window.clearInterval(id)
  }, [refreshEvery])

  useEffect(() => {
    const bump = () => setRefreshToken((t) => t + 1)
    window.addEventListener(GDC_HEADER_REFRESH_EVENT, bump)
    return () => window.removeEventListener(GDC_HEADER_REFRESH_EVENT, bump)
  }, [])

  const numericSelected = useMemo(() => {
    if (!selectedId || !/^\d+$/.test(selectedId)) return null
    return Number(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (numericSelected == null) {
      setDetailStats(null)
      setDetailMetrics(null)
      return
    }
    let cancelled = false
    const snapshot_id = dash?.snapshot_id ?? createRuntimeSnapshotId()
    ;(async () => {
      setDetailLoading(true)
      try {
        const [st, m] = await Promise.all([
          fetchStreamRuntimeStats(numericSelected, 120),
          fetchStreamRuntimeMetrics(numericSelected, timeRange, { snapshot_id }),
        ])
        if (!cancelled && m != null && !snapshotMatches(snapshot_id, m)) return
        if (!cancelled) {
          setDetailStats(st)
          setDetailMetrics(m)
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dash?.snapshot_id, numericSelected, refreshToken, timeRange])

  useEffect(() => {
    if (numericSelected == null || detailMetrics == null || detailLoading) return
    setMetricsByStream((prev) => {
      const next = new Map(prev)
      next.set(numericSelected, detailMetrics)
      return next
    })
  }, [numericSelected, detailMetrics, detailLoading])

  useEffect(() => {
    const toFetch = expandedStreamIds.filter((sid) => sid !== numericSelected && Number.isFinite(sid))
    if (!toFetch.length) return
    let cancelled = false
    const snapshot_id = dash?.snapshot_id ?? createRuntimeSnapshotId()
    for (const sid of toFetch) {
      setRowMetricsInlineLoading((p) => ({ ...p, [sid]: true }))
    }
    void (async () => {
      await Promise.all(
        toFetch.map(async (sid) => {
          try {
            const m = await fetchStreamRuntimeMetrics(sid, timeRange, { snapshot_id })
            if (cancelled) return
            if (m != null && !snapshotMatches(snapshot_id, m)) return
            if (m) {
              setMetricsByStream((prev) => {
                const next = new Map(prev)
                next.set(sid, m)
                return next
              })
            }
          } finally {
            if (!cancelled) {
              setRowMetricsInlineLoading((p) => ({ ...p, [sid]: false }))
            }
          }
        }),
      )
    })()
    return () => {
      cancelled = true
      for (const sid of toFetch) {
        setRowMetricsInlineLoading((p) => ({ ...p, [sid]: false }))
      }
    }
  }, [dash?.snapshot_id, expandedStreamIds, numericSelected, timeRange, refreshToken])

  const toggleStreamRowMetricsExpand = useCallback((sid: number) => {
    setExpandedStreamIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]))
  }, [])

  const streamNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of rows) {
      const id = Number(r.id)
      if (Number.isFinite(id)) m.set(id, r.name)
    }
    return m
  }, [rows])

  const kpis = useMemo(
    () =>
      buildMonitoringKpis(
        dash?.summary ?? null,
        rows,
        metricsByStream,
        timeRange,
        dash?.metrics_window_seconds ?? 3600,
        dash?.metric_meta,
      ),
    [dash, rows, metricsByStream, timeRange],
  )

  const counts = useMemo(() => statusCounts(rows), [rows])
  const runningTotal = dash?.summary?.running_streams ?? rows.filter((r) => r.status === 'RUNNING').length

  const mergedTimeline = useMemo(() => mergeEventsOverTime(metricsByStream), [metricsByStream])
  const chartData = useMemo(
    () => mergedTimeline.map((p) => ({ name: p.label, total: p.events, ts: p.t })),
    [mergedTimeline],
  )

  const top5 = useMemo(() => topStreamsByMetric(rows, metricsByStream, 5), [rows, metricsByStream])
  const donutTotalEps = useMemo(() => top5.reduce((a, s) => a + s.eventsPerSec, 0), [top5])
  const globalThroughputEps = useMemo(() => {
    const events = dash?.summary.processed_events ?? 0
    const seconds = dash?.metrics_window_seconds ?? 3600
    return seconds > 0 ? Math.max(0, events) / seconds : 0
  }, [dash?.summary.processed_events, dash?.metrics_window_seconds])
  const donutSlices = useMemo(
    () => donutFromTopStreams(top5, globalThroughputEps || donutTotalEps || 1),
    [top5, globalThroughputEps, donutTotalEps],
  )
  const top5SubsetMeta = useMemo(
    () =>
      enrichSubsetMeta(
        dash?.visualization_meta?.['runtime.top_streams.throughput_share.window_avg_eps'],
        donutTotalEps,
        globalThroughputEps,
      ),
    [dash?.visualization_meta, donutTotalEps, globalThroughputEps],
  )
  const top5Coverage = formatCoverageRatio(top5SubsetMeta?.subset?.subset_coverage_ratio)
  const top5Semantics = visualizationSummary(
    top5SubsetMeta ? { [top5SubsetMeta.chart_metric_id]: top5SubsetMeta } : dash?.visualization_meta,
    'runtime.top_streams.throughput_share.window_avg_eps',
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (!rowMatchesTab(row, tab)) return false
      if (!q) return true
      return `${row.name} ${row.connectorName} ${row.id}`.toLowerCase().includes(q)
    })
  }, [rows, tab, search])

  useEffect(() => {
    if (urlResolved.error || urlResolveBusy || loading) return
    const sid = urlResolved.effectiveStreamId
    if (sid == null) return
    const idStr = String(sid)
    if (!rows.some((r) => r.id === idStr)) return
    setSelectedId(idStr)
    setTab('all')
    setSearch('')
  }, [
    urlFilterSignature,
    urlResolved.effectiveStreamId,
    urlResolved.error,
    urlResolveBusy,
    loading,
    rowIdsSignature,
    rows,
  ])

  useEffect(() => {
    if (urlResolved.effectiveStreamId == null || urlResolved.error) return
    const idStr = String(urlResolved.effectiveStreamId)
    const idx = filteredRows.findIndex((r) => r.id === idStr)
    if (idx < 0) return
    setPage(Math.floor(idx / pageSize) + 1)
  }, [filteredRows, urlResolved.effectiveStreamId, urlResolved.error, urlFilterSignature, pageSize])

  useEffect(() => {
    setPage(1)
  }, [tab, search])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, page, pageSize])

  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId), [rows, selectedId])

  const highlightRouteId = urlResolved.highlightRouteId ?? queryRouteId ?? null

  const streamRowForUrlFilter = useMemo(() => {
    if (urlResolved.effectiveStreamId == null) return null
    return rows.find((r) => r.id === String(urlResolved.effectiveStreamId)) ?? null
  }, [rows, urlResolved.effectiveStreamId])

  const urlFilterBanner = useMemo(() => {
    if (!hasUrlFilters) return null
    if (loading || urlResolveBusy) return null
    if (urlResolved.error === 'route_not_found') return 'Invalid route filter: route was not found.'
    if (urlResolved.error === 'stream_mismatch') return 'Invalid filters: route does not belong to the selected stream.'
    if (urlResolved.error === 'no_route_for_destination')
      return 'Invalid destination filter: no route targets this destination.'
    if (urlResolved.effectiveStreamId != null && !streamRowForUrlFilter)
      return 'Stream filter does not match any visible stream (check permissions or stream list).'
    return null
  }, [
    hasUrlFilters,
    loading,
    urlResolveBusy,
    urlResolved.error,
    urlResolved.effectiveStreamId,
    streamRowForUrlFilter,
  ])

  const runControl = useCallback(
    async (action: 'start' | 'stop') => {
      if (numericSelected == null || controlBusy || runOnceBusy) return
      setControlBusy(true)
      setActionMsg(null)
      try {
        const res = action === 'start' ? await startRuntimeStream(numericSelected) : await stopRuntimeStream(numericSelected)
        setActionMsg(res?.message ?? (action === 'start' ? 'Start requested' : 'Stop requested'))
        setRefreshToken((t) => t + 1)
      } finally {
        setControlBusy(false)
      }
    },
    [numericSelected, controlBusy, runOnceBusy],
  )

  const runOnce = useCallback(async () => {
    if (numericSelected == null || runOnceBusy || controlBusy) return
    setRunOnceBusy(true)
    setActionMsg(null)
    try {
      await runStreamOnce(numericSelected)
      setActionMsg('Run-once completed')
      setRefreshToken((t) => t + 1)
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRunOnceBusy(false)
    }
  }, [numericSelected, runOnceBusy, controlBusy])

  const levelBadge = (level: string) => {
    const u = level.toUpperCase()
    if (u === 'ERROR') return 'border-red-500/20 bg-red-500/[0.08] text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100'
    if (u === 'WARN' || u === 'WARNING')
      return 'border-amber-500/20 bg-amber-500/[0.08] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
    return 'border-sky-500/20 bg-sky-500/[0.08] text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100'
  }

  const routesSummary = detailStats?.routes?.length
    ? `${detailStats.routes.filter((r) => r.enabled).length}/${detailStats.routes.length} enabled`
    : selectedRow
      ? `${selectedRow.routesOk} healthy · ${selectedRow.routesDegraded} warning · ${selectedRow.routesError} error`
      : '—'

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="max-w-xl text-[13px] text-slate-600 dark:text-gdc-muted">
                Monitor real-time stream health and system resources.
              </p>
              <Link
                to={NAV_PATH.analytics}
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/70"
              >
                Delivery analytics
              </Link>
            </div>
            {(hasUrlFilters || urlResolveBusy) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Context
                </span>
                {urlResolveBusy ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/90 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Resolving filters…
                  </span>
                ) : null}
                {queryStreamId != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300/40 bg-slate-500/[0.06] py-0.5 pl-2 pr-1 text-[11px] font-medium text-slate-800 dark:border-gdc-borderStrong/40 dark:bg-slate-400/10 dark:text-slate-200">
                    Filtered by Stream · {streamRowForUrlFilter?.name ?? `#${queryStreamId}`}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-gdc-rowHover dark:hover:text-slate-100"
                      aria-label="Remove stream filter"
                      onClick={() => removeRuntimeUrlParam('stream_id')}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ) : null}
                {queryRouteId != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300/40 bg-slate-500/[0.06] py-0.5 pl-2 pr-1 text-[11px] font-medium text-slate-800 dark:border-gdc-borderStrong/40 dark:bg-slate-400/10 dark:text-slate-200">
                    Filtered by Route · #{queryRouteId}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-gdc-rowHover dark:hover:text-slate-100"
                      aria-label="Remove route filter"
                      onClick={() => removeRuntimeUrlParam('route_id')}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ) : null}
                {queryDestinationId != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300/40 bg-slate-500/[0.06] py-0.5 pl-2 pr-1 text-[11px] font-medium text-slate-800 dark:border-gdc-borderStrong/40 dark:bg-slate-400/10 dark:text-slate-200">
                    Filtered by Destination · #{queryDestinationId}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-gdc-rowHover dark:hover:text-slate-100"
                      aria-label="Remove destination filter"
                      onClick={() => removeRuntimeUrlParam('destination_id')}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                RUN
              </span>
              <span className="text-[12px] font-medium text-slate-600 dark:text-gdc-muted">
                {runningTotal} streams active
              </span>
              <div className="hidden h-4 w-px bg-slate-200 dark:bg-gdc-elevated sm:block" aria-hidden />
              <div className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100">
                <Clock className="h-3 w-3 text-slate-400 dark:text-gdc-muted" aria-hidden />
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as MetricsWindow)}
                  className="max-w-[140px] cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100"
                  aria-label="Time range"
                >
                  <option value="15m">Last 15 minutes</option>
                  <option value="1h">Last hour</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last 24 hours</option>
                </select>
              </div>
              <div className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100">
                <RefreshCw className="h-3 w-3 text-slate-400 dark:text-gdc-muted" aria-hidden />
                <select
                  value={refreshEvery}
                  onChange={(e) => {
                    const next = e.target.value as RuntimeRefreshEvery
                    setRefreshEvery(next)
                    persistRuntimeRefreshEvery(next)
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100"
                  aria-label="Refresh interval"
                >
                  <option value="10s">10s</option>
                  <option value="30s">30s</option>
                  <option value="1m">1m</option>
                  <option value="off">Off</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={newStreamPath()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden />+ New stream
              </Link>
              <Link
                to="/streams"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:hover:bg-gdc-rowHover"
              >
                Stream console
              </Link>
              <button
                type="button"
                onClick={() => setRefreshToken((t) => t + 1)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2.5 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Refresh
              </button>
            </div>
          </div>
        </header>

        {loadError ? (
          <div
            role="alert"
            data-testid={authRequired ? 'runtime-auth-required' : 'runtime-load-error'}
            className={cn(
              'rounded-lg border px-3 py-2 text-[12px]',
              authRequired
                ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-50'
                : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100',
            )}
          >
            {authRequired ? GDC_AUTH_REQUIRED_MESSAGE : loadError}
          </div>
        ) : null}

        {urlFilterBanner ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-50"
          >
            {urlFilterBanner}
          </div>
        ) : null}

        {!loading && startupStatus != null ? (
          <MigrationIntegrityPanel
            report={startupStatus.migration_integrity}
            unavailable={startupStatus.migration_integrity == null}
            compact
          />
        ) : null}

        <section aria-label="Runtime KPI summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
          {kpis.map((kpi) => (
            <div
              key={kpi.id}
              title={kpi.title}
              className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-sm dark:border-gdc-border/90 dark:bg-gdc-card"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{kpi.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{kpi.value}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{kpi.subLabel}</p>
              <div className={cn('mt-1.5', toneClass(kpi.tone))}>
                <MiniSparkline values={kpi.trend} />
              </div>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12 xl:items-stretch">
          <section
            aria-label="Stream status"
            className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card xl:col-span-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Streams</h2>
              <div className="relative max-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="search"
                  placeholder="Search…"
                  className="h-8 w-full rounded-md border border-slate-200/90 bg-white py-1 pl-8 pr-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card"
                  aria-label="Search streams"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-slate-100 px-2 py-2 dark:border-gdc-divider">
              {(
                [
                  ['all', `All ${rows.length}`],
                  ['normal', `Healthy ${counts.normal}`],
                  ['warning', `Warning ${counts.warning}`],
                  ['error', `Error ${counts.error}`],
                  ['stopped', `Stopped ${counts.stopped}`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                    tab === k
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-gdc-elevated dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading…
                </div>
              ) : (
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={cn(opTh, 'w-9 pr-0')} scope="col">
                        <span className="sr-only">Expand metrics</span>
                      </th>
                      <th className={opTh}>Stream</th>
                      <th className={opTh}>Connector</th>
                      <th className={opTh}>Status</th>
                      <th className={opTh}>Throughput</th>
                      <th className={opTh}>Latency</th>
                      <th className={opTh}>Poll</th>
                      <th className={opTh}>Source limit</th>
                      <th className={opTh}>Last success</th>
                      <th className={opTh}>Last failure</th>
                      <th className={opTh}>Routes</th>
                      <th className={opTh}>Backfill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr className={opTr}>
                        <td className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500')} colSpan={12}>
                          {hasUrlFilters && filteredRows.length === 0 && rows.length > 0
                            ? 'No streams match the current filters and search.'
                            : rows.length === 0
                              ? 'No streams to display.'
                              : 'No streams match the current filters.'}
                        </td>
                      </tr>
                    ) : null}
                    {pageRows.map((row) => {
                      const sid = Number(row.id)
                      const lat = Number.isFinite(sid) ? metricsByStream.get(sid)?.kpis?.avg_latency_ms : undefined
                      const m = Number.isFinite(sid) ? metricsByStream.get(sid) : undefined
                      const winSec =
                        m?.metrics_window_seconds != null && Number.isFinite(m.metrics_window_seconds)
                          ? m.metrics_window_seconds
                          : 3600
                      const evh =
                        m?.kpis?.events_last_hour != null && Number.isFinite(m.kpis.events_last_hour)
                          ? Math.max(0, m.kpis.events_last_hour)
                          : row.events1h
                      const eps = evh / Math.max(1, winSec)
                      const periodLabel = timeRange
                      const lastOk = m?.stream?.last_success_at
                      const lastFail = m?.stream?.last_error_at
                      const routeLine = summarizeRouteRuntimeConnectivity(m?.route_runtime)
                      const bf = Number.isFinite(sid) ? backfillByStream.get(sid) : undefined
                      const selected = row.id === selectedId
                      const numericRowId = /^\d+$/.test(row.id) ? Number(row.id) : NaN
                      const rowExpandable = Number.isFinite(numericRowId)
                      const rowExpanded = rowExpandable && expandedStreamIds.includes(numericRowId)
                      const rowLatencyPending =
                        (selected && detailLoading && numericSelected === sid) ||
                        (Number.isFinite(sid) && rowMetricsInlineLoading[sid])
                      return (
                        <Fragment key={row.id}>
                        <tr
                          className={cn(opTr, selected && 'bg-violet-50/80 dark:bg-violet-950/20')}
                        >
                          <td className={cn(opTd, 'w-9 pr-0 align-middle')}>
                            {rowExpandable ? (
                              <button
                                type="button"
                                aria-expanded={rowExpanded}
                                aria-label={rowExpanded ? 'Collapse stream metrics' : 'Expand stream metrics'}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 dark:text-gdc-muted dark:hover:border-gdc-border dark:hover:bg-gdc-rowHover"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleStreamRowMetricsExpand(numericRowId)
                                }}
                              >
                                {rowExpanded ? (
                                  <ChevronDown className="h-4 w-4" aria-hidden />
                                ) : (
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                )}
                              </button>
                            ) : null}
                          </td>
                          <td className={opTd}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(row.id)}
                              onFocus={() => setSelectedId(row.id)}
                              className="text-left font-medium text-violet-700 hover:underline dark:text-violet-300"
                            >
                              {row.name}
                            </button>
                          </td>
                          <td className={cn(opTd, 'max-w-[140px] truncate')}>{row.connectorName}</td>
                          <td className={opTd}>
                            <StatusBadge tone={uiStatusTone(row.status)}>{statusLabelEn(row.status)}</StatusBadge>
                          </td>
                          <td className={cn(opTd, 'max-w-[120px] text-[11px] leading-snug')}>
                            <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                              {formatCompactInt(evh)}{' '}
                              <span className="text-[10px] font-medium normal-case text-slate-500 dark:text-gdc-muted">/ {periodLabel}</span>
                            </div>
                            <div className="tabular-nums text-[10px] text-slate-500 dark:text-gdc-muted">
                              {evh > 0 ? `${eps >= 1 ? eps.toFixed(2) : eps.toFixed(3)} /s` : 'idle'}
                            </div>
                          </td>
                          <td className={cn(opTd, 'tabular-nums')}>
                            {lat != null && Number.isFinite(lat) ? (
                              `${Math.round(lat)} ms`
                            ) : rowLatencyPending ? (
                              <span className="inline-flex items-center gap-1 text-slate-400 dark:text-gdc-muted" title="Loading metrics">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                <span className="sr-only">Loading metrics</span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={cn(opTd, 'tabular-nums text-[11px]')}>{row.pollingIntervalSec}s</td>
                          <td className={cn(opTd, 'max-w-[100px] truncate text-[10px] text-slate-600 dark:text-gdc-muted')} title={row.rateLimitLabel}>
                            {row.rateLimitLabel}
                          </td>
                          <td className={cn(opTd, 'whitespace-nowrap font-mono text-[10px] text-slate-700 dark:text-gdc-mutedStrong')}>
                            {lastOk ? formatShortTs(lastOk) : '—'}
                          </td>
                          <td
                            className={cn(
                              opTd,
                              'whitespace-nowrap font-mono text-[10px]',
                              lastFail ? 'text-red-800 dark:text-red-300/90' : 'text-slate-500 dark:text-gdc-muted',
                            )}
                          >
                            {lastFail ? formatShortTs(lastFail) : '—'}
                          </td>
                          <td className={cn(opTd, 'max-w-[140px] text-[10px] leading-snug text-slate-700 dark:text-gdc-mutedStrong')} title={routeLine}>
                            {routeLine}
                          </td>
                          <td className={cn(opTd, 'text-[10px] font-medium')}>
                            {bf ? (
                              <span className="rounded border border-violet-200 bg-violet-50 px-1 py-px text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                                {bf}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                        {rowExpanded ? (
                          <tr className={opTr}>
                            <td colSpan={12} className={cn(opTd, 'border-t border-slate-100 bg-slate-50/60 py-2 dark:border-gdc-divider dark:bg-gdc-section/80')}>
                              {rowMetricsInlineLoading[numericRowId] ||
                              (numericSelected === numericRowId && detailLoading) ? (
                                <span className="inline-flex items-center gap-2 text-[11px] text-slate-500 dark:text-gdc-muted">
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                  Loading route metrics…
                                </span>
                              ) : (
                                <p className="text-[11px] leading-snug text-slate-700 dark:text-gdc-mutedStrong">
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">Routes: </span>
                                  {summarizeRouteRuntimeConnectivity(metricsByStream.get(numericRowId)?.route_runtime)}
                                </p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {!loading && filteredRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[11px] dark:border-gdc-border">
                <span className="text-slate-500 dark:text-gdc-muted">
                  {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredRows.length)} / {filteredRows.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-800 disabled:opacity-40 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page * pageSize >= filteredRows.length}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-800 disabled:opacity-40 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                  >
                    Next
                  </button>
                  <span className="text-slate-500 dark:text-gdc-muted">Per page {pageSize}</span>
                </div>
              </div>
            ) : null}
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card xl:col-span-5">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Throughput</h2>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-[10px] font-medium dark:border-gdc-border dark:bg-gdc-card">
                <Gauge className="h-3 w-3" aria-hidden />
                Top streams (sample)
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
            <div className="h-[220px] w-full shrink-0 min-w-0 p-2">
              {chartData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[12px] text-slate-500 dark:text-gdc-muted">
                  {detailLoading && numericSelected != null ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-violet-500" aria-hidden />
                      <p>Loading timeline for the selected stream…</p>
                    </>
                  ) : rows.length > 0 ? (
                    <>
                      <p>No timeline data in view</p>
                      <p className="max-w-xs text-[11px] text-slate-400 dark:text-gdc-muted">
                        Select or expand a stream to load per-stream metrics into this chart.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>No runtime samples yet</p>
                      <span className="text-[11px] text-slate-400 dark:text-gdc-muted">Charts fill as delivery metrics arrive.</span>
                    </>
                  )}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={32} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(value: number) => [`${value} events`, 'Total']}
                    />
                    <Line type="monotone" dataKey="total" name="Events" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200/80 dark:border-gdc-border">
              <div className="flex items-center justify-between px-3 py-2">
                <div>
                  <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Throughput share (top 5)</h3>
                  <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">{top5Semantics}</p>
                </div>
              </div>
              <div className="flex min-h-[160px] flex-1 flex-col items-center justify-center px-2 pb-3 pt-0">
                {donutSlices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
                    {detailLoading && numericSelected != null && rows.length > 0 && chartData.length === 0 ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin text-violet-500" aria-hidden />
                        <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Loading throughput share…</p>
                      </>
                    ) : (
                      <p className="text-[12px] text-slate-500 dark:text-gdc-muted">No metrics yet for distribution.</p>
                    )}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutSlices.map((d) => ({ name: d.name, value: d.value }))}
                        innerRadius={48}
                        outerRadius={68}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {donutSlices.map((_, i) => (
                          <Cell key={`c-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [`${v.toFixed(3)} evt/s`, 'window avg']}
                        labelFormatter={(label) => `${label} · ${top5Coverage}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {donutTotalEps > 0 ? (
                  <p className="text-center text-[11px] font-medium text-slate-600 dark:text-gdc-muted">
                    Top 5 {donutTotalEps.toFixed(3)} evt/s · Global {globalThroughputEps.toFixed(3)} evt/s · {top5Coverage}
                  </p>
                ) : null}
              </div>
            </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card xl:col-span-6">
            <div className="border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Stream detail</h2>
            </div>
            <div className="space-y-2 p-3 text-[12px]">
              {selectedRow ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{selectedRow.name}</p>
                    <StatusBadge tone={uiStatusTone(selectedRow.status)}>{statusLabelEn(selectedRow.status)}</StatusBadge>
                  </div>
                  <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Connector</dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-200">{selectedRow.connectorName}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Routes</dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-200">{routesSummary}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Route telemetry</dt>
                      <dd className="text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                        {detailLoading ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-gdc-muted">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            Loading…
                          </span>
                        ) : (
                          summarizeRouteRuntimeConnectivity(detailMetrics?.route_runtime)
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Last checkpoint</dt>
                      <dd className="font-mono text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                        {detailLoading ? '…' : detailStats?.checkpoint ? JSON.stringify(detailStats.checkpoint.value).slice(0, 120) : selectedRow.lastCheckpointDisplay}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Last run</dt>
                      <dd className="font-mono text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                        {detailLoading ? (
                          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-gdc-muted">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          </span>
                        ) : detailMetrics?.stream?.last_run_at ? (
                          formatShortTs(detailMetrics.stream.last_run_at)
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Last success</dt>
                      <dd className="font-mono text-[11px] text-emerald-800 dark:text-emerald-300/90">
                        {detailLoading ? (
                          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-gdc-muted">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          </span>
                        ) : detailMetrics?.stream?.last_success_at ? (
                          formatShortTs(detailMetrics.stream.last_success_at)
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Last failure</dt>
                      <dd className="font-mono text-[11px] text-red-800 dark:text-red-300/90">
                        {detailLoading ? (
                          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-gdc-muted">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          </span>
                        ) : detailMetrics?.stream?.last_error_at ? (
                          formatShortTs(detailMetrics.stream.last_error_at)
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Source rate limit</dt>
                      <dd className="text-[11px] text-slate-700 dark:text-gdc-mutedStrong">{selectedRow.rateLimitLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase text-slate-500">Logs / failures</dt>
                      <dd className="tabular-nums text-slate-700 dark:text-gdc-mutedStrong">
                        {detailStats?.summary
                          ? `${detailStats.summary.total_logs.toLocaleString()} · failures ${(detailStats.summary.route_send_failed + detailStats.summary.route_retry_failed).toLocaleString()}`
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                  {highlightRouteId != null ? (
                    <div className="rounded-lg border border-violet-200/80 bg-violet-50/50 px-2 py-1.5 dark:border-violet-900/50 dark:bg-violet-950/30">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                        URL filter focus
                      </p>
                      {detailStats?.routes?.some((r) => r.route_id === highlightRouteId) ? (
                        <ul className="mt-1 space-y-1">
                          {detailStats.routes
                            .filter((r) => r.route_id === highlightRouteId)
                            .map((r) => (
                              <li key={r.route_id} className="text-[11px] font-medium text-slate-800 dark:text-slate-100">
                                Route #{r.route_id} · {r.destination_type.replace(/_/g, ' ')} ·{' '}
                                {r.enabled ? 'enabled' : 'disabled'}
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                          Route #{highlightRouteId} is not present in the current stream stats snapshot (may be disabled or
                          inactive).
                        </p>
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      to={streamRuntimePath(selectedRow.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
                    >
                      Open runtime <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                    <Link
                      to={streamEditPath(selectedRow.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                    >
                      Settings
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-slate-500">Select a stream.</p>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50 shadow-sm dark:border-gdc-border dark:bg-gdc-card xl:col-span-6">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Host resources</h2>
              <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <div className="space-y-2 p-4 text-[12px] text-slate-600 dark:text-gdc-mutedStrong">
              {sysRes ? (
                <ul className="space-y-1.5">
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-500">CPU</span>
                    <span className="tabular-nums font-medium">{sysRes.cpu_percent.toFixed(1)}%</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-500">Memory</span>
                    <span className="tabular-nums font-medium">
                      {sysRes.memory_percent.toFixed(1)}% ({formatBytes(sysRes.memory_used_bytes)} /{' '}
                      {formatBytes(sysRes.memory_total_bytes)})
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-500">Disk</span>
                    <span className="tabular-nums font-medium">
                      {sysRes.disk_percent.toFixed(1)}% ({formatBytes(sysRes.disk_used_bytes)} / {formatBytes(sysRes.disk_total_bytes)})
                    </span>
                  </li>
                  <li className="flex justify-between gap-2 text-[11px]">
                    <span className="text-slate-500">Network</span>
                    <span className="tabular-nums">
                      in {sysRes.network_in_bytes_per_sec.toFixed(1)} B/s · out {sysRes.network_out_bytes_per_sec.toFixed(1)} B/s
                    </span>
                  </li>
                </ul>
              ) : (
                <p className="text-slate-500">Resource metrics unavailable.</p>
              )}
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
            <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Recent delivery logs</h2>
            <Link to="/logs" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh}>Time</th>
                  <th className={opTh}>Level</th>
                  <th className={opTh}>Stream</th>
                  <th className={opTh}>Stage</th>
                  <th className={opTh}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {!recentLogs?.length ? (
                  <tr className={opTr}>
                    <td className={cn(opTd, 'py-6 text-center text-slate-500')} colSpan={5}>
                      No logs or API unavailable.
                    </td>
                  </tr>
                ) : (
                  recentLogs.map((log) => {
                    const sid = log.stream_id
                    const sname = sid != null ? streamNameById.get(sid) ?? `#${sid}` : '—'
                    const logsDrill =
                      sid != null
                        ? logsExplorerPath({
                            stream_id: sid,
                            route_id: log.route_id ?? undefined,
                            destination_id: log.destination_id ?? undefined,
                            run_id: log.run_id ?? undefined,
                          })
                        : null
                    return (
                      <tr key={log.id} className={opTr}>
                        <td className={cn(opTd, 'whitespace-nowrap tabular-nums text-[11px]')}>{formatShortTs(log.created_at)}</td>
                        <td className={opTd}>
                          <span className={cn('inline-flex rounded border px-1.5 py-px text-[10px] font-semibold', levelBadge(log.level))}>
                            {log.level}
                          </span>
                        </td>
                        <td className={opTd}>
                          {sid != null && logsDrill ? (
                            <Link to={logsDrill} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
                              {sname}
                            </Link>
                          ) : sid != null ? (
                            <Link to={logsPath(String(sid))} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
                              {sname}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={cn(opTd, 'max-w-[140px] truncate text-[11px]')}>{log.stage}</td>
                        <td className={cn(opTd, 'max-w-[320px] truncate text-[11px] text-slate-600 dark:text-gdc-muted')}>{log.message}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
          KPIs use the runtime summary and per-stream stats/health. Heavy per-stream metrics load when a stream is selected, its
          row is expanded, or the stream name control is focused; charts merge loaded stream metrics only.
        </p>
      </div>

      <aside className="w-full shrink-0 space-y-3 lg:w-[280px]" aria-label="Operations panel">
        <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Recent alerts</h2>
          <ul className="mt-2 space-y-2">
            {alertItems.length === 0 ? (
              <li className="text-[11px] text-slate-500">No WARN/ERROR groups in this window.</li>
            ) : (
              alertItems.map((a) => (
                <li
                  key={`${a.stream_id}-${a.severity}-${a.latest_occurrence}`}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section"
                >
                  <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                    {a.severity} · {a.stream_name}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {a.connector_name} · {a.count}× · {formatShortTs(a.latest_occurrence)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Quick actions</h2>
          {actionMsg ? <p className="mt-1 text-[11px] text-violet-700 dark:text-violet-300">{actionMsg}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={numericSelected == null || controlBusy}
              onClick={() => void runControl('start')}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] font-semibold text-emerald-900 disabled:opacity-40 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Start
            </button>
            <button
              type="button"
              disabled={numericSelected == null || controlBusy}
              onClick={() => void runControl('stop')}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-[11px] font-semibold text-red-900 disabled:opacity-40 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
            >
              <Square className="h-3.5 w-3.5" aria-hidden />
              Stop
            </button>
            <button
              type="button"
              disabled={numericSelected == null || runOnceBusy}
              onClick={() => void runOnce()}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-2 text-[11px] font-semibold text-violet-900 disabled:opacity-40 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100"
            >
              <Rocket className="h-3.5 w-3.5" aria-hidden />
              Run once
            </button>
            <Link
              to={numericSelected != null ? streamEditPath(String(numericSelected)) : '/streams'}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-semibold text-slate-800 dark:border-gdc-border dark:text-slate-100',
                numericSelected == null && 'pointer-events-none opacity-40',
              )}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              Settings
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">System</h2>
          <ul className="mt-2 space-y-2 text-[12px]">
            <li className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-gdc-muted">Engine</span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200">
                {dash?.runtime_engine_status ?? '—'}
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-gdc-muted">Workers</span>
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-100">
                {dash?.active_worker_count ?? '—'}
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-gdc-muted">Enabled routes</span>
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-100">
                {dash?.summary ? `${dash.summary.enabled_routes}/${dash.summary.total_routes}` : '—'}
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-gdc-muted">Running streams</span>
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-100">
                {dash?.summary?.running_streams ?? '—'}
              </span>
            </li>
            <li className="flex items-start justify-between gap-2 border-t border-slate-100 pt-2 dark:border-gdc-border">
              <span className="text-slate-600 dark:text-gdc-muted">Problem routes</span>
              <span className="max-w-[140px] text-right text-[10px] text-slate-500">
                {dash?.recent_problem_routes?.length
                  ? `${dash.recent_problem_routes.length} · see logs`
                  : 'None'}
              </span>
            </li>
          </ul>
        </section>

        <RuntimeRetentionSection />

        <div className="rounded-lg border border-amber-200/80 bg-amber-500/[0.06] p-2 text-[11px] text-amber-950 dark:border-amber-900/40 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mb-1 inline h-3.5 w-3.5" aria-hidden />
          Batch runs across all streams will ship as a separate API. Use the stream console for now.
        </div>
      </aside>
    </div>
  )
}
