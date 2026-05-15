import {
  ArrowDownToLine,
  ChevronDown,
  ClipboardList,
  Columns3,
  Cpu,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchDestinationsList, testDestination, type DestinationListItem } from '../../api/gdcDestinations'
import {
  fetchRoutesList,
  updateRoute,
  type RouteRead,
} from '../../api/gdcRoutes'
import {
  fetchRuntimeDashboardSummary,
  fetchStreamRuntimeMetrics,
  saveRuntimeRouteEnabledState,
  searchRuntimeDeliveryLogs,
  type MetricsWindow,
} from '../../api/gdcRuntime'
import { fetchStreamsList } from '../../api/gdcStreams'
import type { StreamRead } from '../../api/types/gdcApi'
import type { RouteRuntimeMetricsRow, RuntimeLogSearchItem } from '../../api/types/gdcApi'
import { destinationDetailPath, logsExplorerPath, routeEditPath, runtimeOverviewPath, streamRuntimePath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { opStateRow, opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { StatusBadge, type StatusTone } from '../shell/status-badge'
import {
  aggregateDestinationDonut,
  backoffFieldsFromRoute,
  buildRouteConsoleRows,
  countRouteStatuses,
  formatDestinationEndpoint,
  formatFailurePolicy,
  formatRateLimitCell,
  lastActivityIso,
  mergeMetricsFromStreams,
  mergeSuccessRateFromBuckets,
  mergeThroughputSeries,
  relativeShort,
  routePublicId,
  type RouteUiStatus,
} from './routes-overview-helpers'

const PIE_COLORS = ['#7c3aed', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b']

const WINDOW_OPTIONS: { value: MetricsWindow; label: string }[] = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
]

function MiniSparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 52
  const h = 18
  const padX = 2
  const padY = 2
  const nums = values.length ? [...values] : [0]
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const pts = nums.map((v, i) => {
    const x = padX + (i / Math.max(nums.length - 1, 1)) * innerW
    const y = padY + (1 - (v - min) / range) * innerH
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts.join(' ')} />
    </svg>
  )
}

function ThinProgress({ pct, toneClass }: { pct: number; toneClass: string }) {
  const width = `${Math.min(100, Math.max(0, pct))}%`
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
      <div className={cn('h-full rounded-full transition-[width]', toneClass)} style={{ width }} />
    </div>
  )
}

function DeliveryMeter({ pct }: { pct: number }) {
  const tone =
    pct >= 99 ? 'bg-emerald-500' : pct >= 90 ? 'bg-amber-500' : pct <= 0 ? 'bg-slate-300 dark:bg-slate-600' : 'bg-red-500'
  const width = `${Math.min(100, Math.max(0, pct))}%`
  const label =
    pct >= 100 ? `${pct.toFixed(0)}%` : pct <= 0 ? '0%' : `${Math.round(pct * 100) / 100}%`
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{label}</p>
      <div className="h-1 w-full max-w-[96px] overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width }} />
      </div>
    </div>
  )
}

function uiStatusTone(s: RouteUiStatus): StatusTone {
  switch (s) {
    case 'Healthy':
      return 'success'
    case 'Warning':
      return 'warning'
    case 'Error':
      return 'error'
    case 'Disabled':
      return 'neutral'
    case 'Idle':
      return 'neutral'
    default:
      return 'neutral'
  }
}

function statusDotClass(s: RouteUiStatus): string {
  switch (s) {
    case 'Healthy':
      return 'bg-emerald-500'
    case 'Warning':
      return 'bg-amber-500'
    case 'Error':
      return 'bg-red-500'
    case 'Disabled':
      return 'bg-slate-400'
    case 'Idle':
      return 'bg-slate-400'
    default:
      return 'bg-slate-400'
  }
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-[7.5rem] appearance-none rounded-md border border-slate-200/90 bg-white py-1 pl-2 pr-7 text-[12px] font-medium text-slate-800 shadow-none focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
    </div>
  )
}

async function fetchMetricsBatched(streamIds: number[], window: MetricsWindow, concurrency = 6) {
  const out: Awaited<ReturnType<typeof fetchStreamRuntimeMetrics>>[] = []
  for (let i = 0; i < streamIds.length; i += concurrency) {
    const chunk = streamIds.slice(i, i + concurrency)
    const part = await Promise.all(chunk.map((sid) => fetchStreamRuntimeMetrics(sid, window)))
    out.push(...part)
  }
  return out
}

type QuickFilter = 'all' | 'healthy' | 'warning' | 'error' | 'disabled' | 'problem'

export function RoutesOverviewPage() {
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>('1h')
  const [refreshTick, setRefreshTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [routesRaw, setRoutesRaw] = useState<RouteRead[]>([])
  const [streamsState, setStreamsState] = useState<StreamRead[]>([])
  const [destinationsState, setDestinationsState] = useState<DestinationListItem[]>([])
  const [dash, setDash] = useState<Awaited<ReturnType<typeof fetchRuntimeDashboardSummary>>>(null)
  const [metricsByRouteId, setMetricsByRouteId] = useState<Map<number, RouteRuntimeMetricsRow>>(() => new Map())
  const [metricsList, setMetricsList] = useState<Awaited<ReturnType<typeof fetchStreamRuntimeMetrics>>[]>([])
  const [recentLogs, setRecentLogs] = useState<RuntimeLogSearchItem[]>([])

  const [search, setSearch] = useState('')
  const [streamFilter, setStreamFilter] = useState('__all__')
  const [destinationFilter, setDestinationFilter] = useState('__all__')
  const [statusFilter, setStatusFilter] = useState('__all__')
  const [policyFilter, setPolicyFilter] = useState('__all__')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [highErr, setHighErr] = useState(false)
  const [highLat, setHighLat] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(8)
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const [showRateLimitCol, setShowRateLimitCol] = useState(true)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [testBusyId, setTestBusyId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null)
  const [moreMenuRouteId, setMoreMenuRouteId] = useState<number | null>(null)
  const [routePanelLogs, setRoutePanelLogs] = useState<RuntimeLogSearchItem[]>([])
  const [panelLogsLoading, setPanelLogsLoading] = useState(false)

  const columnsRef = useRef<HTMLDivElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!columnsRef.current?.contains(e.target as Node)) setColumnsMenuOpen(false)
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreMenuRouteId(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(t)
  }, [toast])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [routes, streams, destinations, summary, logs] = await Promise.all([
        fetchRoutesList(),
        fetchStreamsList(),
        fetchDestinationsList(),
        fetchRuntimeDashboardSummary(500, metricsWindow),
        searchRuntimeDeliveryLogs({ limit: 80, window: metricsWindow }),
      ])

      const rList = routes ?? []
      const sList = streams ?? []
      const dList = destinations ?? []
      setStreamsState(sList)
      setDestinationsState(dList)

      const streamIds = [...new Set(rList.map((x) => x.stream_id).filter((x): x is number => typeof x === 'number'))]
      const mList = streamIds.length ? await fetchMetricsBatched(streamIds, metricsWindow) : []
      const merged = mergeMetricsFromStreams(mList)

      setRoutesRaw(rList)
      setDash(summary)
      setMetricsByRouteId(merged)
      setMetricsList(mList)
      setRecentLogs(logs?.logs ?? [])

      setSelectedRouteId((prev) => {
        if (prev != null && rList.some((x) => x.id === prev)) return prev
        return rList[0]?.id ?? null
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load routes console.')
    } finally {
      setLoading(false)
    }
  }, [metricsWindow, refreshTick])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (selectedRouteId == null) {
      setRoutePanelLogs([])
      return
    }
    let cancelled = false
    setPanelLogsLoading(true)
    ;(async () => {
      const res = await searchRuntimeDeliveryLogs({
        route_id: selectedRouteId,
        limit: 48,
        window: metricsWindow,
      })
      if (cancelled) return
      setRoutePanelLogs(res?.logs ?? [])
      setPanelLogsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRouteId, metricsWindow, refreshTick])

  const consoleRows = useMemo(
    () => buildRouteConsoleRows(routesRaw, streamsState, destinationsState, metricsByRouteId),
    [routesRaw, streamsState, destinationsState, metricsByRouteId],
  )

  const streamOptions = useMemo(() => {
    const names = new Set<string>()
    for (const r of consoleRows) {
      const n = (r.stream?.name ?? '').trim()
      if (n) names.add(n)
    }
    return ['__all__', ...[...names].sort()]
  }, [consoleRows])

  const destinationOptions = useMemo(() => {
    const names = new Set<string>()
    for (const r of consoleRows) {
      const n = (r.destination?.name ?? '').trim()
      if (n) names.add(n)
    }
    return ['__all__', ...[...names].sort()]
  }, [consoleRows])

  const policyOptions = useMemo(() => {
    const p = new Set<string>()
    for (const r of consoleRows) {
      const fp = (r.route.failure_policy ?? '').trim()
      if (fp) p.add(fp)
    }
    return ['__all__', ...[...p].sort()]
  }, [consoleRows])

  const statusCounts = useMemo(() => countRouteStatuses(consoleRows), [consoleRows])

  const throughputSeries = useMemo(() => mergeThroughputSeries(metricsList), [metricsList])
  const successSeries = useMemo(() => mergeSuccessRateFromBuckets(metricsList), [metricsList])
  const donutData = useMemo(() => aggregateDestinationDonut(metricsByRouteId), [metricsByRouteId])
  const donutTotal = useMemo(() => donutData.reduce((a, d) => a + d.value, 0), [donutData])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return consoleRows.filter((row) => {
      const destName = (row.destination?.name ?? '').trim()
      const streamName = (row.stream?.name ?? '').trim()
      const hay = `${row.routeLabel} ${routePublicId(row.route.id)} ${streamName} ${destName}`.toLowerCase()
      if (q && !hay.includes(q)) return false
      if (streamFilter !== '__all__' && streamName !== streamFilter) return false
      if (destinationFilter !== '__all__' && destName !== destinationFilter) return false
      if (policyFilter !== '__all__' && (row.route.failure_policy ?? '') !== policyFilter) return false
      if (statusFilter !== '__all__') {
        const want = statusFilter as RouteUiStatus
        if (row.uiStatus !== want) return false
      }
      if (quickFilter === 'healthy' && row.uiStatus !== 'Healthy') return false
      if (quickFilter === 'warning' && row.uiStatus !== 'Warning') return false
      if (quickFilter === 'error' && row.uiStatus !== 'Error') return false
      if (quickFilter === 'disabled' && row.uiStatus !== 'Disabled') return false
      if (quickFilter === 'problem' && (row.uiStatus === 'Healthy' || row.uiStatus === 'Idle')) return false
      if (highErr && (!row.metrics || row.metrics.success_rate >= 95)) return false
      if (highLat && (!row.metrics || row.metrics.avg_latency_ms <= 200)) return false
      return true
    })
  }, [
    consoleRows,
    search,
    streamFilter,
    destinationFilter,
    statusFilter,
    policyFilter,
    quickFilter,
    highErr,
    highLat,
  ])

  useEffect(() => {
    setPage(1)
  }, [search, streamFilter, destinationFilter, statusFilter, policyFilter, quickFilter, highErr, highLat])

  const totalFiltered = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageOffset = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(pageOffset, pageOffset + pageSize)

  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage, page])

  const selectedRow = useMemo(
    () => consoleRows.find((r) => r.route.id === selectedRouteId) ?? null,
    [consoleRows, selectedRouteId],
  )

  const schedulerRunning = dash?.runtime_engine_status === 'RUNNING'

  const kpiTotal = dash?.summary.total_routes ?? routesRaw.length
  const kpiEnabled = dash?.summary.enabled_routes ?? routesRaw.filter((r) => r.enabled !== false).length
  const kpiDisabled = dash?.summary.disabled_routes ?? Math.max(0, kpiTotal - kpiEnabled)

  const activeRoutes = statusCounts.total - statusCounts.disabled
  const healthyPct = activeRoutes > 0 ? (100 * statusCounts.healthy) / activeRoutes : 0
  const warningPct = activeRoutes > 0 ? (100 * statusCounts.warning) / activeRoutes : 0
  const errorPct = activeRoutes > 0 ? (100 * statusCounts.error) / activeRoutes : 0

  const totalEps = useMemo(() => {
    let s = 0
    for (const r of metricsByRouteId.values()) s += r.eps_current
    return s
  }, [metricsByRouteId])

  const totalErrWindow = dash?.summary.recent_failures ?? 0

  const throughputSpark = useMemo(() => throughputSeries.slice(-8).map((p) => p.eps), [throughputSeries])
  const errorsSpark = useMemo(() => {
    const sr = successSeries.slice(-8).map((p) => 100 - p.pct)
    return sr.length ? sr : [0]
  }, [successSeries])

  function clearFilters() {
    setSearch('')
    setStreamFilter('__all__')
    setDestinationFilter('__all__')
    setStatusFilter('__all__')
    setPolicyFilter('__all__')
    setQuickFilter('all')
    setHighErr(false)
    setHighLat(false)
  }

  async function onToggleRoute(enabled: boolean) {
    if (!selectedRow?.route.id || toggleBusy) return
    setToggleBusy(true)
    try {
      const res = await saveRuntimeRouteEnabledState(selectedRow.route.id, enabled)
      if (!res) {
        await updateRoute(selectedRow.route.id, {
          enabled,
          status: enabled ? 'ENABLED' : 'DISABLED',
        })
      }
      setRefreshTick((x) => x + 1)
    } catch (e) {
      setToast({
        tone: 'err',
        message: e instanceof Error ? e.message : 'Could not update route.',
      })
    } finally {
      setToggleBusy(false)
    }
  }

  async function onTestRoute(routeId: number, destinationId: number | null) {
    if (destinationId == null || testBusyId != null) return
    setTestBusyId(routeId)
    try {
      const res = await testDestination(destinationId)
      const latencyPart =
        typeof res.latency_ms === 'number' && Number.isFinite(res.latency_ms)
          ? ` · ${res.latency_ms.toFixed(0)} ms`
          : ''
      setToast({
        tone: res.success ? 'ok' : 'err',
        message: `${res.success ? 'Destination test succeeded' : 'Destination test failed'} — ${res.message}${latencyPart}`,
      })
      setRefreshTick((x) => x + 1)
    } catch (e) {
      setToast({
        tone: 'err',
        message: e instanceof Error ? e.message : 'Destination test failed.',
      })
    } finally {
      setTestBusyId(null)
    }
  }

  const pageNumbers = useMemo(() => {
    const windowN = 3
    const start = Math.max(1, Math.min(safePage - 1, totalPages - windowN + 1))
    return Array.from({ length: Math.min(windowN, totalPages) }, (_, i) => start + i).filter((n) => n <= totalPages)
  }, [safePage, totalPages])

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
          {loadError}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Routes</h2>
          <p className="max-w-xl text-[13px] text-slate-600 dark:text-gdc-muted">
            Manage delivery routes between streams and destinations
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {dash ? (
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                schedulerRunning
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                  : 'border-slate-300/40 bg-slate-500/[0.06] text-slate-800 dark:border-gdc-borderStrong/40 dark:bg-slate-400/10 dark:text-slate-200',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', schedulerRunning ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
              {schedulerRunning ? 'RUN' : dash.runtime_engine_status ?? 'STOPPED'}
              <span className="font-normal opacity-80">
                {schedulerRunning ? 'Scheduler is running' : 'Scheduler idle / stopped'}
              </span>
            </div>
          ) : loading ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Status…
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">Runtime status unavailable</span>
          )}
          <SelectField
            id="routes-window"
            label="Metrics window"
            value={metricsWindow}
            options={WINDOW_OPTIONS}
            onChange={(v) => setMetricsWindow(v as MetricsWindow)}
          />
          <button
            type="button"
            onClick={() => {
              setRefreshTick((x) => x + 1)
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200/90 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          </button>
          <Link
            to={routeEditPath('new')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create Route
          </Link>
        </div>
      </div>

      <section aria-label="Route KPI summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Routes</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{kpiTotal}</p>
          <p className="mt-1 text-[11px] font-medium">
            <span className="text-emerald-700 dark:text-emerald-400">Enabled {kpiEnabled}</span>
            <span className="text-slate-400"> · </span>
            <span className="text-red-700 dark:text-red-400">Disabled {kpiDisabled}</span>
          </p>
          <div className="mt-1.5 text-violet-600 dark:text-violet-400">
            <MiniSparkline values={throughputSpark.length ? throughputSpark : [0]} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Healthy Routes</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {statusCounts.healthy}{activeRoutes ? ` (${healthyPct.toFixed(1)}%)` : ''}
          </p>
          <ThinProgress pct={healthyPct} toneClass="bg-emerald-500" />
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Warning Routes</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {statusCounts.warning}{activeRoutes ? ` (${warningPct.toFixed(1)}%)` : ''}
          </p>
          <ThinProgress pct={warningPct} toneClass="bg-amber-500" />
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Error Routes</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {statusCounts.error}{activeRoutes ? ` (${errorPct.toFixed(1)}%)` : ''}
          </p>
          <ThinProgress pct={errorPct} toneClass="bg-red-500" />
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Throughput</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {totalEps.toLocaleString(undefined, { maximumFractionDigits: 1 })} EPS
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Events per second</p>
          <div className="mt-1.5 text-violet-600 dark:text-violet-400">
            <MiniSparkline values={throughputSpark.length ? throughputSpark : [0]} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Errors</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {totalErrWindow.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {WINDOW_OPTIONS.find((w) => w.value === metricsWindow)?.label ?? 'Window'}
          </p>
          <div className="mt-1.5 text-red-500 dark:text-red-400">
            <MiniSparkline values={errorsSpark} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search routes…"
                  className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
                  aria-label="Search routes"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex-1">
                <SelectField
                  id="routes-filter-stream"
                  label="Stream filter"
                  value={streamFilter}
                  options={streamOptions.map((v) => ({ value: v, label: v === '__all__' ? 'All Streams' : v }))}
                  onChange={setStreamFilter}
                />
                <SelectField
                  id="routes-filter-destination"
                  label="Destination filter"
                  value={destinationFilter}
                  options={destinationOptions.map((v) => ({
                    value: v,
                    label: v === '__all__' ? 'All Destinations' : v,
                  }))}
                  onChange={setDestinationFilter}
                />
                <SelectField
                  id="routes-filter-status"
                  label="Status filter"
                  value={statusFilter}
                  options={[
                    { value: '__all__', label: 'All Statuses' },
                    { value: 'Healthy', label: 'Healthy' },
                    { value: 'Warning', label: 'Warning' },
                    { value: 'Error', label: 'Error' },
                    { value: 'Disabled', label: 'Disabled' },
                    { value: 'Idle', label: 'Idle' },
                  ]}
                  onChange={setStatusFilter}
                />
                <SelectField
                  id="routes-filter-policy"
                  label="Failure policy filter"
                  value={policyFilter}
                  options={policyOptions.map((v) => ({
                    value: v,
                    label: v === '__all__' ? 'All Failure Policies' : formatFailurePolicy(v),
                  }))}
                  onChange={setPolicyFilter}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 dark:border-gdc-border">
              <button
                type="button"
                onClick={clearFilters}
                className="text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                Clear
              </button>
              <div className="relative" ref={columnsRef}>
                <button
                  type="button"
                  onClick={() => setColumnsMenuOpen((o) => !o)}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  aria-expanded={columnsMenuOpen}
                >
                  <Columns3 className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  Columns
                </button>
                {columnsMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-slate-200/90 bg-white py-2 text-[12px] shadow-lg dark:border-gdc-border dark:bg-gdc-card"
                  >
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-gdc-rowHover">
                      <input type="checkbox" checked={showRateLimitCol} onChange={(e) => setShowRateLimitCol(e.target.checked)} />
                      Rate Limit
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                Routes ({routesRaw.length})
              </h3>
              {loading ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading…
                </span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className={opTable}>
                <thead className="sticky top-0 z-20">
                  <tr className={cn(opThRow, 'shadow-sm')}>
                    <th scope="col" className={cn(opTh, 'min-w-[120px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Route
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[120px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Stream
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[180px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Destination
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[88px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Status
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[96px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Throughput (EPS)
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[104px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Success Rate
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[88px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Avg Latency
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[72px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Errors
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[96px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Last Activity
                    </th>
                    <th scope="col" className={cn(opTh, 'min-w-[140px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Failure Policy
                    </th>
                    {showRateLimitCol ? (
                      <th scope="col" className={cn(opTh, 'min-w-[100px] bg-slate-50/95 backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                        Rate Limit
                      </th>
                    ) : null}
                    <th scope="col" className={cn(opTh, 'min-w-[96px] bg-slate-50/95 text-right backdrop-blur-sm dark:bg-gdc-tableHeader')}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && routesRaw.length === 0
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={`sk-${i}`} className="border-b border-slate-100/90 dark:border-gdc-divider">
                          {Array.from({ length: showRateLimitCol ? 12 : 11 }).map((__, j) => (
                            <td key={j} className="px-2.5 py-2">
                              <div className="h-2.5 animate-pulse rounded bg-slate-200/90 dark:bg-gdc-elevated" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : null}
                  {!loading && pageRows.length === 0 ? (
                    <tr className={cn(opTr, opStateRow)}>
                      <td
                        className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500 dark:text-gdc-muted')}
                        colSpan={showRateLimitCol ? 12 : 11}
                      >
                        {routesRaw.length === 0 ? 'No routes configured yet.' : 'No routes found for the selected filters.'}
                      </td>
                    </tr>
                  ) : null}
                  {pageRows.map((row) => {
                    const m = row.metrics
                    const sr = m ? m.success_rate : null
                    const eps = m ? m.eps_current : 0
                    const lat = m ? m.avg_latency_ms : null
                    const errCount = m ? m.failed_last_hour : null
                    const lastAct = relativeShort(lastActivityIso(m))
                    const selected = row.route.id === selectedRouteId
                    const logsHref = logsExplorerPath({
                      route_id: row.route.id,
                      stream_id: row.stream?.id ?? undefined,
                      destination_id: row.destination?.id ?? row.route.destination_id ?? undefined,
                    })
                    const streamId = row.stream?.id
                    const destId = row.destination?.id ?? row.route.destination_id
                    return (
                      <tr
                        key={row.route.id}
                        className={cn(
                          opTr,
                          selected ? 'bg-violet-500/[0.09] dark:bg-violet-500/15' : '',
                          'cursor-pointer',
                        )}
                        onClick={() => setSelectedRouteId(row.route.id)}
                      >
                        <td className={opTd}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedRouteId(row.route.id)
                            }}
                            className="flex min-w-0 items-center gap-2 text-left"
                          >
                            <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', statusDotClass(row.uiStatus))} aria-hidden />
                            <span className="text-[12px] font-semibold text-violet-800 dark:text-violet-200">
                              {routePublicId(row.route.id)}
                            </span>
                          </button>
                        </td>
                        <td className={opTd}>
                          <span className="text-[12px] font-medium text-slate-800 dark:text-slate-200">
                            {(row.stream?.name ?? '').trim() || '—'}
                          </span>
                        </td>
                        <td className={opTd}>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                              {(row.destination?.name ?? '').trim() || '—'}
                            </p>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              {row.destination?.destination_type?.replace(/_/g, ' ') ?? '—'}
                            </p>
                          </div>
                        </td>
                        <td className={opTd}>
                          <StatusBadge tone={uiStatusTone(row.uiStatus)}>{row.uiStatus}</StatusBadge>
                        </td>
                        <td className={opTd}>
                          <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                            {m ? eps.toFixed(2) : '—'}
                          </span>
                        </td>
                        <td className={opTd}>{sr != null ? <DeliveryMeter pct={sr} /> : <span className="text-slate-400">—</span>}</td>
                        <td className={opTd}>
                          <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                            {lat != null && lat >= 0 ? `${Math.round(lat)} ms` : '—'}
                          </span>
                        </td>
                        <td className={opTd}>
                          <span
                            className={cn(
                              'text-[12px] font-semibold tabular-nums',
                              errCount != null && errCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100',
                            )}
                          >
                            {errCount != null ? errCount.toLocaleString() : '—'}
                          </span>
                        </td>
                        <td className={opTd}>
                          <span className="text-[11px] tabular-nums text-slate-600 dark:text-gdc-muted">{lastAct}</span>
                        </td>
                        <td className={opTd}>
                          <span className="text-[11px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                            {formatFailurePolicy(row.route.failure_policy)}
                          </span>
                        </td>
                        {showRateLimitCol ? (
                          <td className={opTd}>
                            <span className="text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                              {formatRateLimitCell(row.route.rate_limit_json)}
                            </span>
                          </td>
                        ) : null}
                        <td className={cn(opTd, 'text-right')} onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              disabled={row.destination == null || testBusyId === row.route.id}
                              onClick={() =>
                                void onTestRoute(row.route.id, row.destination?.id ?? row.route.destination_id ?? null)
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                              aria-label={`Test route ${routePublicId(row.route.id)}`}
                              title="Test Route"
                            >
                              {testBusyId === row.route.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <Play className="h-3.5 w-3.5" aria-hidden />
                              )}
                            </button>
                            <Link
                              to={logsHref}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                              aria-label={`View logs for route ${routePublicId(row.route.id)}`}
                              title="View Logs"
                            >
                              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                            <div
                              className="relative"
                              ref={moreMenuRouteId === row.route.id ? moreMenuRef : undefined}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMoreMenuRouteId((id) => (id === row.route.id ? null : row.route.id))
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                                aria-label="More route actions"
                                aria-expanded={moreMenuRouteId === row.route.id}
                              >
                                <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              {moreMenuRouteId === row.route.id ? (
                                <div
                                  role="menu"
                                  className="absolute right-0 z-40 mt-1 w-[11.5rem] rounded-md border border-slate-200/90 bg-white py-1 text-[11px] shadow-lg dark:border-gdc-border dark:bg-gdc-card"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Link
                                    to={routeEditPath(String(row.route.id))}
                                    className="block px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                                    onClick={() => setMoreMenuRouteId(null)}
                                  >
                                    Edit Route
                                  </Link>
                                  <Link
                                    to={runtimeOverviewPath({
                                      stream_id: streamId ?? undefined,
                                      route_id: row.route.id,
                                      destination_id: destId ?? undefined,
                                    })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                                    onClick={() => setMoreMenuRouteId(null)}
                                  >
                                    <Cpu className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                                    View Runtime
                                  </Link>
                                  <Link
                                    to={logsHref}
                                    className="block px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                                    onClick={() => setMoreMenuRouteId(null)}
                                  >
                                    View Logs
                                  </Link>
                                  {streamId != null ? (
                                    <Link
                                      to={streamRuntimePath(String(streamId))}
                                      className="block px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                                      onClick={() => setMoreMenuRouteId(null)}
                                    >
                                      Open Stream
                                    </Link>
                                  ) : (
                                    <span className="block cursor-not-allowed px-3 py-1.5 text-slate-400">Open Stream</span>
                                  )}
                                  {destId != null ? (
                                    <Link
                                      to={destinationDetailPath(String(destId))}
                                      className="block px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                                      onClick={() => setMoreMenuRouteId(null)}
                                    >
                                      Open Destination
                                    </Link>
                                  ) : (
                                    <span className="block cursor-not-allowed px-3 py-1.5 text-slate-400">Open Destination</span>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted sm:flex-row sm:items-center sm:justify-between">
              <p className="tabular-nums">
                Showing {totalFiltered === 0 ? 0 : pageOffset + 1} to {Math.min(pageOffset + pageSize, totalFiltered)} of{' '}
                {totalFiltered} routes
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200/90 px-2 py-1 text-[11px] font-semibold text-slate-700 enabled:hover:bg-slate-50 disabled:opacity-40 dark:border-gdc-border dark:text-slate-200 dark:enabled:hover:bg-slate-800/60"
                  >
                    Previous
                  </button>
                  {pageNumbers.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={cn(
                        'min-w-[1.75rem] rounded px-2 py-1 text-[11px] font-semibold tabular-nums',
                        n === safePage
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-slate-200/90 px-2 py-1 text-[11px] font-semibold text-slate-700 enabled:hover:bg-slate-50 disabled:opacity-40 dark:border-gdc-border dark:text-slate-200 dark:enabled:hover:bg-slate-800/60"
                  >
                    Next
                  </button>
                </div>
                <label className="flex items-center gap-1.5 font-medium">
                  <span className="sr-only">Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value))
                      setPage(1)
                    }}
                    className="h-8 rounded-md border border-slate-200/90 bg-white py-1 pl-2 pr-7 text-[11px] font-semibold text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                  >
                    {[8, 10, 25, 50].map((n) => (
                      <option key={n} value={n}>
                        {n} / page
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <h3 className="mb-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">Throughput (EPS)</h3>
              <div className="h-[180px] w-full">
                {throughputSeries.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-[12px] text-slate-500">No throughput time-series yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={throughputSeries.map((d) => ({ t: d.timestamp.slice(11, 16), eps: d.eps }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-gdc-divider" />
                      <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={32} />
                      <Tooltip formatter={(v: number) => [`${v.toFixed(3)} EPS`, 'Throughput']} />
                      <Area type="monotone" dataKey="eps" stroke="#7c3aed" fill="#7c3aed33" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <h3 className="mb-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">Route Success Rate (%)</h3>
              <div className="h-[180px] w-full">
                {successSeries.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-[12px] text-slate-500">No success rate buckets yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={successSeries.map((d) => ({ t: d.timestamp.slice(11, 16), pct: d.pct }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-gdc-divider" />
                      <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
                      <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Success']} />
                      <Area type="monotone" dataKey="pct" stroke="#22c55e" fill="#22c55e33" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <h3 className="mb-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">Events by Destination</h3>
              <div className="flex h-[180px] flex-col items-center justify-center">
                {donutData.length === 0 ? (
                  <p className="text-center text-[12px] text-slate-500">No destination distribution for this window.</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData.map((d) => ({ name: d.name, value: d.value }))}
                          innerRadius={48}
                          outerRadius={68}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {donutData.map((_, i) => (
                            <Cell key={`cell-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Events']} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <p className="text-center text-[11px] font-medium text-slate-600 dark:text-gdc-muted">
                      {donutTotal.toLocaleString()} Events
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Recent Route Events</h3>
              <Link to="/logs" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                View all logs
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className={opTable}>
                <thead>
                  <tr className={opThRow}>
                    <th className={opTh}>Time</th>
                    <th className={opTh}>Level</th>
                    <th className={opTh}>Route</th>
                    <th className={opTh}>Stream</th>
                    <th className={opTh}>Destination</th>
                    <th className={opTh}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.length === 0 ? (
                    <tr className={opTr}>
                      <td className={cn(opTd, 'py-6 text-center text-slate-500')} colSpan={6}>
                        No recent delivery log rows in this window.
                      </td>
                    </tr>
                  ) : (
                    recentLogs.slice(0, 12).map((log) => {
                      const level = (log.level ?? '').toUpperCase()
                      const levelCls =
                        level === 'ERROR'
                          ? 'border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-100'
                          : level === 'WARN'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
                            : 'border-blue-500/40 bg-blue-500/10 text-blue-900 dark:text-blue-100'
                      const rid = log.route_id
                      const streamLabel =
                        rid != null
                          ? (consoleRows.find((r) => r.route.id === rid)?.stream?.name ?? '—')
                          : log.stream_id != null
                            ? streamsState.find((s) => s.id === log.stream_id)?.name ?? `Stream #${log.stream_id}`
                            : '—'
                      const destLabel =
                        log.destination_id != null
                          ? destinationsState.find((d) => d.id === log.destination_id)?.name ?? `Destination #${log.destination_id}`
                          : '—'
                      return (
                        <tr key={`${log.id}-${log.created_at}`} className={opTr}>
                          <td className={cn(opTd, 'whitespace-nowrap text-[11px] tabular-nums text-slate-600')}>
                            {log.created_at.slice(0, 19).replace('T', ' ')}
                          </td>
                          <td className={opTd}>
                            <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', levelCls)}>
                              {level || '—'}
                            </span>
                          </td>
                          <td className={opTd}>
                            {rid != null ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                                onClick={() => setSelectedRouteId(rid)}
                              >
                                {routePublicId(rid)}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={opTd}>
                            <span className="text-[11px] text-slate-700 dark:text-gdc-mutedStrong">{streamLabel}</span>
                          </td>
                          <td className={opTd}>
                            <span className="text-[11px] text-slate-700 dark:text-gdc-mutedStrong">{destLabel}</span>
                          </td>
                          <td className={opTd}>
                            <span className="line-clamp-2 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">{log.message}</span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Route Details</h3>
            {selectedRow ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-slate-900 dark:text-slate-50">{routePublicId(selectedRow.route.id)}</span>
                    <StatusBadge tone={uiStatusTone(selectedRow.uiStatus)}>{selectedRow.uiStatus}</StatusBadge>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">
                    <span>{selectedRow.route.enabled !== false ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      checked={selectedRow.route.enabled !== false}
                      disabled={toggleBusy}
                      onChange={(e) => void onToggleRoute(e.target.checked)}
                    />
                  </label>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-[11px]">
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Stream</dt>
                    <dd className="min-w-0 text-right font-medium text-violet-700 dark:text-violet-300">
                      {selectedRow.stream?.id != null ? (
                        <Link to={streamRuntimePath(String(selectedRow.stream.id))} className="hover:underline">
                          {(selectedRow.stream.name ?? '').trim() || `Stream #${selectedRow.stream.id}`}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Destination</dt>
                    <dd className="min-w-0 text-right font-medium text-violet-700 dark:text-violet-300">
                      {selectedRow.destination?.id != null ? (
                        <Link to={destinationDetailPath(String(selectedRow.destination.id))} className="hover:underline">
                          {(selectedRow.destination.name ?? '').trim() || `Destination #${selectedRow.destination.id}`}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Destination type</dt>
                    <dd className="text-right text-slate-800 dark:text-slate-100">
                      {selectedRow.destination?.destination_type?.replace(/_/g, ' ') ?? '—'}
                    </dd>
                  </div>
                  {(() => {
                    const ep = formatDestinationEndpoint(selectedRow.destination)
                    return (
                      <>
                        <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                          <dt className="text-slate-500">Host / URL</dt>
                          <dd className="max-w-[180px] truncate text-right font-mono text-[10px] text-slate-800 dark:text-slate-100">
                            {ep.hostOrUrl}
                          </dd>
                        </div>
                        {selectedRow.destination?.destination_type !== 'WEBHOOK_POST' ? (
                          <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                            <dt className="text-slate-500">Port</dt>
                            <dd className="text-right tabular-nums text-slate-800">{ep.port ?? '—'}</dd>
                          </div>
                        ) : null}
                        {selectedRow.destination?.destination_type !== 'WEBHOOK_POST' ? (
                          <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                            <dt className="text-slate-500">Protocol</dt>
                            <dd className="text-right text-slate-800">{ep.protocol ?? '—'}</dd>
                          </div>
                        ) : null}
                      </>
                    )
                  })()}
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Failure Policy</dt>
                    <dd className="text-right text-slate-800 dark:text-slate-100">{formatFailurePolicy(selectedRow.route.failure_policy)}</dd>
                  </div>
                  {(() => {
                    const b = backoffFieldsFromRoute(selectedRow.route.rate_limit_json)
                    return (
                      <>
                        <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                          <dt className="text-slate-500">Max Retries</dt>
                          <dd className="text-right tabular-nums">{b.maxRetries}</dd>
                        </div>
                        <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                          <dt className="text-slate-500">Initial Backoff</dt>
                          <dd className="text-right tabular-nums">{b.initialBackoffSec}s</dd>
                        </div>
                        <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                          <dt className="text-slate-500">Max Backoff</dt>
                          <dd className="text-right tabular-nums">{b.maxBackoffSec}s</dd>
                        </div>
                      </>
                    )
                  })()}
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Rate Limit</dt>
                    <dd className="text-right text-slate-800">{formatRateLimitCell(selectedRow.route.rate_limit_json)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Created At</dt>
                    <dd className="text-right text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                      {(selectedRow.route as { created_at?: string | null }).created_at?.slice(0, 19).replace('T', ' ') ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Last Updated</dt>
                    <dd className="text-right text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                      {(selectedRow.route as { updated_at?: string | null }).updated_at?.slice(0, 19).replace('T', ' ') ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Last Delivery</dt>
                    <dd className="text-right text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                      {relativeShort(lastActivityIso(selectedRow.metrics))}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Last Success</dt>
                    <dd className="text-right text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                      {selectedRow.metrics?.last_success_at ? relativeShort(selectedRow.metrics.last_success_at) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Last Failure</dt>
                    <dd className="text-right text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                      {selectedRow.metrics?.last_failure_at ? relativeShort(selectedRow.metrics.last_failure_at) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-gdc-border">
                    <dt className="text-slate-500">Events Processed</dt>
                    <dd className="text-right text-[10px] font-medium tabular-nums text-slate-800 dark:text-slate-100">
                      {selectedRow.metrics
                        ? (
                            selectedRow.metrics.delivered_last_hour + selectedRow.metrics.failed_last_hour
                          ).toLocaleString()
                        : '—'}
                    </dd>
                  </div>
                </dl>
                <div className="border-t border-slate-100 pt-2 dark:border-gdc-border">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent Errors</p>
                  {panelLogsLoading ? (
                    <p className="mt-1 text-[11px] text-slate-500">Loading…</p>
                  ) : (
                    <ul className="mt-1 max-h-[7rem] space-y-1 overflow-y-auto text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                      {routePanelLogs.filter((l) => {
                        const lv = (l.level ?? '').toUpperCase()
                        return lv === 'ERROR' || lv === 'WARN'
                      }).length === 0 ? (
                        <li className="text-slate-500">No WARN/ERROR rows in this window.</li>
                      ) : (
                        routePanelLogs
                          .filter((l) => {
                            const lv = (l.level ?? '').toUpperCase()
                            return lv === 'ERROR' || lv === 'WARN'
                          })
                          .slice(0, 5)
                          .map((l) => (
                            <li key={`${l.id}-${l.created_at}`} className="line-clamp-2 border-b border-slate-50 pb-1 dark:border-gdc-divider">
                              <span className="font-semibold text-slate-600 dark:text-gdc-muted">
                                {(l.level ?? '').toUpperCase()}
                              </span>{' '}
                              · {l.message}
                            </li>
                          ))
                      )}
                    </ul>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={selectedRow.destination == null || testBusyId === selectedRow.route.id}
                    onClick={() =>
                      void onTestRoute(selectedRow.route.id, selectedRow.destination?.id ?? selectedRow.route.destination_id ?? null)
                    }
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 dark:border-gdc-border dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                  >
                    <Play className="h-3 w-3" aria-hidden />
                    Test Route
                  </button>
                  <Link
                    to={logsExplorerPath({
                      route_id: selectedRow.route.id,
                      stream_id: selectedRow.stream?.id ?? undefined,
                      destination_id: selectedRow.destination?.id ?? selectedRow.route.destination_id ?? undefined,
                    })}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                  >
                    <ClipboardList className="h-3 w-3" aria-hidden />
                    View Logs
                  </Link>
                  <Link
                    to={routeEditPath(String(selectedRow.route.id))}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                  >
                    Edit Route
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onToggleRoute(!(selectedRow.route.enabled !== false))}
                    disabled={toggleBusy}
                    className={cn(
                      'inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold',
                      selectedRow.route.enabled !== false
                        ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30'
                        : 'border-emerald-200 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-950/30',
                    )}
                  >
                    {selectedRow.route.enabled !== false ? 'Disable Route' : 'Enable Route'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-slate-500">Select a route from the table.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
              Route Health ({WINDOW_OPTIONS.find((w) => w.value === metricsWindow)?.label ?? 'window'})
            </h3>
            <ul className="mt-2 space-y-2 text-[11px]">
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Healthy Routes</span>
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{statusCounts.healthy}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Warning Routes</span>
                <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{statusCounts.warning}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Error Routes</span>
                <span className="font-semibold tabular-nums text-red-700 dark:text-red-400">{statusCounts.error}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Disabled Routes</span>
                <span className="font-semibold tabular-nums text-slate-600 dark:text-gdc-muted">{statusCounts.disabled}</span>
              </li>
              <li className="flex justify-between gap-2 border-t border-slate-100 pt-2 dark:border-gdc-border">
                <span className="font-medium text-slate-700 dark:text-gdc-mutedStrong">Total Routes</span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{statusCounts.total}</span>
              </li>
            </ul>
            {selectedRow?.metrics ? (
              <div className="mt-3 border-t border-slate-100 pt-3 text-[11px] dark:border-gdc-border">
                <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">Selected route metrics</p>
                <ul className="space-y-1 text-slate-600 dark:text-gdc-muted">
                  <li className="flex justify-between gap-2">
                    <span>Delivered (window)</span>
                    <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {selectedRow.metrics.delivered_last_hour.toLocaleString()}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Failed (window)</span>
                    <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {selectedRow.metrics.failed_last_hour.toLocaleString()}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Success rate</span>
                    <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {selectedRow.metrics.success_rate.toFixed(2)}%
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>Avg latency</span>
                    <span className="tabular-nums">{Math.round(selectedRow.metrics.avg_latency_ms)} ms</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>P95 latency</span>
                    <span className="tabular-nums">{Math.round(selectedRow.metrics.p95_latency_ms)} ms</span>
                  </li>
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Quick Filters</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'All Routes'],
                  ['healthy', 'Healthy'],
                  ['warning', 'Warning'],
                  ['error', 'Error'],
                  ['disabled', 'Disabled'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQuickFilter(key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    quickFilter === key
                      ? 'border-violet-500 bg-violet-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setQuickFilter('problem')}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              <ArrowDownToLine className="h-3 w-3" aria-hidden />
              Show Only Problem Routes
            </button>
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-[11px] dark:border-gdc-border">
              <label className="flex cursor-pointer items-center gap-2 text-slate-600 dark:text-gdc-muted">
                <input type="checkbox" checked={highErr} onChange={(e) => setHighErr(e.target.checked)} />
                High Error Rate (&lt;95% success)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-600 dark:text-gdc-muted">
                <input type="checkbox" checked={highLat} onChange={(e) => setHighLat(e.target.checked)} />
                High Latency (&gt;200ms avg)
              </label>
            </div>
          </section>
        </aside>
      </div>
      {toast ? (
        <div
          role="status"
          className={cn(
            'fixed bottom-4 right-4 z-[100] max-w-md rounded-lg border px-3 py-2 text-[12px] font-medium shadow-lg dark:shadow-black/40',
            toast.tone === 'ok'
              ? 'border-emerald-500/35 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/50 dark:text-emerald-50'
              : 'border-red-500/35 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-50',
          )}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
