import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cpu,
  ChevronDown,
  Filter,
  FlaskConical,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Search,
  Sparkles,
  Square,
  Wand2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { formatRunOnceSummaryLines } from '../../utils/formatRunOnceSummary'
import { StatusBadge } from '../shell/status-badge'
import { opStateRow, opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import {
  logsPath,
  newStreamPath,
  streamApiTestPath,
  streamEditPath,
  streamEnrichmentPath,
  streamMappingPath,
  streamRuntimePath,
} from '../../config/nav-paths'
import {
  fetchRuntimeDashboardSummary,
  fetchRuntimeLogsPage,
  fetchStreamMappingUiConfig,
  fetchStreamRuntimeMetrics,
  fetchStreamRuntimeStats,
  fetchStreamRuntimeStatsHealth,
  fetchStreamRuntimeTimeline,
  runStreamOnce,
  searchRuntimeDeliveryLogs,
  startRuntimeStream,
  stopRuntimeStream,
} from '../../api/gdcRuntime'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { fetchDestinationsList, type DestinationRead } from '../../api/gdcDestinations'
import { fetchRoutesList, type RouteRead } from '../../api/gdcRoutes'
import { fetchStreamById, fetchStreamsList } from '../../api/gdcStreams'
import {
  enrichStreamRowWithRuntime,
  formatCheckpointValueForConsole,
  mergeConnectorLabelIntoRow,
  mergeMappingUiIntoRow,
  streamReadToConsoleRow,
  type StreamConsoleRow,
  type StreamRuntimeStatus,
} from '../../api/streamRows'
import { computeStreamWorkflow, type StreamWorkflowInput, type StreamWorkflowSnapshot } from '../../utils/streamWorkflow'
import { workflowOverridesFromMappingUi } from '../../utils/mappingUiWorkflow'
import { resolveSourceTypePresentation } from '../../utils/sourceTypePresentation'
import { streamsSectionKpiFromSummary, type StreamsSectionKpi } from '../../api/streamsKpi'
import { StreamOperationalBadges } from './stream-operational-badges'
import { StreamWorkflowChecklist, StreamWorkflowProgressBadge } from './stream-workflow-checklist'
import {
  AUTO_REFRESH_OPTIONS,
  CONNECTOR_FILTER_OPTIONS,
  SOURCE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from '../../constants/streamConsoleFilters'
import { isDevValidationLabEntityName } from '../../utils/devValidationLab'
import {
  buildOperationalStreamBadges,
  operationalRunControlTooltipSupplement,
} from '../../utils/streamOperationalBadges'
import { DevValidationBadge } from '../shell/dev-validation-badge'
import {
  loadStreamsAutoRefresh,
  persistStreamsAutoRefresh,
  type StreamsAutoRefreshOption,
} from '../../localPreferences'

type DetailTab =
  | 'configuration'
  | 'runHistory'
  | 'delivery'
  | 'checkpoint'
  | 'routes'
  | 'logs'
  | 'errors'
  | 'metrics'

const DETAIL_TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'configuration', label: 'Configuration' },
  { key: 'runHistory', label: 'Run History' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'checkpoint', label: 'Checkpoint' },
  { key: 'routes', label: 'Routes' },
  { key: 'logs', label: 'Logs' },
  { key: 'errors', label: 'Errors' },
  { key: 'metrics', label: 'Metrics' },
]

function statusTone(s: StreamRuntimeStatus) {
  switch (s) {
    case 'RUNNING':
      return 'success' as const
    case 'DEGRADED':
      return 'warning' as const
    case 'ERROR':
      return 'error' as const
    case 'STOPPED':
      return 'neutral' as const
    case 'UNKNOWN':
      return 'neutral' as const
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

function eventsSparklineClass(status: StreamRuntimeStatus) {
  switch (status) {
    case 'RUNNING':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'DEGRADED':
      return 'text-amber-600 dark:text-amber-400'
    case 'ERROR':
      return 'text-red-600 dark:text-red-400'
    case 'STOPPED':
      return 'text-slate-400 dark:text-gdc-muted'
    case 'UNKNOWN':
      return 'text-slate-400 dark:text-gdc-muted'
    default: {
      const _e: never = status
      return _e
    }
  }
}

function MiniSparkline({ values }: { values: readonly number[] }) {
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts.join(' ')} />
    </svg>
  )
}

function RouteFanOut({ row }: { row: StreamConsoleRow }) {
  const dots: Array<{ tone: 'ok' | 'deg' | 'err' }> = []
  for (let i = 0; i < row.routesOk; i += 1) dots.push({ tone: 'ok' })
  for (let i = 0; i < row.routesDegraded; i += 1) dots.push({ tone: 'deg' })
  for (let i = 0; i < row.routesError; i += 1) dots.push({ tone: 'err' })
  const summaryParts: string[] = []
  if (row.routesOk) summaryParts.push(`${row.routesOk} OK`)
  if (row.routesDegraded) summaryParts.push(`${row.routesDegraded} DEG`)
  if (row.routesError) summaryParts.push(`${row.routesError} ERR`)
  const summary = summaryParts.length ? summaryParts.join(', ') : '—'
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{row.routesTotal}</span>
        <span className="flex items-center gap-0.5" aria-hidden>
          {dots.map((d, idx) => (
            <span
              key={`${d.tone}-${idx}`}
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                d.tone === 'ok' && 'bg-emerald-500',
                d.tone === 'deg' && 'bg-amber-500',
                d.tone === 'err' && 'bg-red-500',
              )}
            />
          ))}
        </span>
      </div>
      <p className="truncate text-[10px] font-medium text-slate-500 dark:text-gdc-muted">{summary}</p>
    </div>
  )
}

function DeliveryMeter({ pct }: { pct: number }) {
  const tone =
    pct >= 99 ? 'bg-emerald-500' : pct >= 90 ? 'bg-amber-500' : pct <= 0 ? 'bg-slate-300 dark:bg-slate-600' : 'bg-red-500'
  const width = `${Math.min(100, Math.max(0, pct))}%`
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{pct.toFixed(pct >= 100 ? 0 : 2)}%</p>
      <div className="h-1 w-full max-w-[88px] overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width }} />
      </div>
    </div>
  )
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
  options: readonly string[]
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
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
    </div>
  )
}

function emptyStreamsKpi(): StreamsSectionKpi {
  return {
    total: 0,
    totalTrend: '—',
    running: 0,
    runningPct: '—',
    degraded: 0,
    degradedPct: '—',
    error: 0,
    errorPct: '—',
    stopped: 0,
    stoppedPct: '—',
    events24h: '—',
    events24hTrend: '—',
  }
}

function streamWorkflowFromRow(row: StreamConsoleRow, extras?: Partial<StreamWorkflowInput>): StreamWorkflowSnapshot {
  return computeStreamWorkflow({
    streamId: row.id,
    status: row.status,
    events1h: row.events1h,
    deliveryPct: row.deliveryPct,
    routesTotal: row.routesTotal,
    routesOk: row.routesOk,
    routesDegraded: row.routesDegraded,
    routesError: row.routesError,
    sourceType: row.streamTypeKey,
    ...extras,
  })
}

export function StreamsConsole() {
  const [search, setSearch] = useState('')
  const [connectorFilter, setConnectorFilter] = useState<string>(CONNECTOR_FILTER_OPTIONS[0])
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_OPTIONS[0])
  const [sourceFilter, setSourceFilter] = useState<string>(SOURCE_FILTER_OPTIONS[0])
  const [autoRefresh, setAutoRefresh] = useState<StreamsAutoRefreshOption>('Off')
  useLayoutEffect(() => {
    setAutoRefresh(loadStreamsAutoRefresh())
  }, [])
  const [displayRows, setDisplayRows] = useState<StreamConsoleRow[]>([])
  const [sectionKpi, setSectionKpi] = useState<StreamsSectionKpi>(emptyStreamsKpi)
  const [streamsLoading, setStreamsLoading] = useState(true)
  const [streamsListError, setStreamsListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [detailTab, setDetailTab] = useState<DetailTab>('configuration')
  const [workflowExtrasByStreamId, setWorkflowExtrasByStreamId] = useState<
    Record<string, Partial<StreamWorkflowInput>>
  >({})
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [runOnceStreamId, setRunOnceStreamId] = useState<number | null>(null)
  const [runOnceBanner, setRunOnceBanner] = useState<{ variant: 'success' | 'error'; lines: string[] } | null>(null)
  const [deliveryMapping, setDeliveryMapping] = useState<Awaited<ReturnType<typeof fetchStreamMappingUiConfig>> | null>(
    null,
  )
  const [panelTimeline, setPanelTimeline] = useState<Awaited<ReturnType<typeof fetchStreamRuntimeTimeline>> | null>(null)
  const [panelTimelineLoading, setPanelTimelineLoading] = useState(false)
  const [panelStats, setPanelStats] = useState<Awaited<ReturnType<typeof fetchStreamRuntimeStats>> | null>(null)
  const [panelStatsLoading, setPanelStatsLoading] = useState(false)
  const [panelRuntimeMetrics, setPanelRuntimeMetrics] = useState<Awaited<ReturnType<typeof fetchStreamRuntimeMetrics>> | null>(
    null,
  )
  const [panelStreamRead, setPanelStreamRead] = useState<Awaited<ReturnType<typeof fetchStreamById>> | null>(null)
  const [panelConfigLoading, setPanelConfigLoading] = useState(false)
  const [panelDeliveryLogs, setPanelDeliveryLogs] = useState<Awaited<ReturnType<typeof searchRuntimeDeliveryLogs>> | null>(null)
  const [panelLogsPage, setPanelLogsPage] = useState<Awaited<ReturnType<typeof fetchRuntimeLogsPage>> | null>(null)
  const [panelErrorLogs, setPanelErrorLogs] = useState<Awaited<ReturnType<typeof searchRuntimeDeliveryLogs>> | null>(null)
  const [panelTabLoading, setPanelTabLoading] = useState(false)
  const [panelRoutesRows, setPanelRoutesRows] = useState<
    Array<{ route: RouteRead; destination: DestinationRead | null }>
  >([])

  const runStreamControl = useCallback(
    async (streamIdNum: number | null, action: 'start' | 'stop') => {
      if (streamIdNum == null || controlBusy || runOnceStreamId !== null) return
      setControlBusy(true)
      setControlMessage(null)
      try {
        const res = action === 'start' ? await startRuntimeStream(streamIdNum) : await stopRuntimeStream(streamIdNum)
        setControlMessage(res?.message ?? (action === 'start' ? 'Start requested.' : 'Stop requested.'))
        setRefreshVersion((v) => v + 1)
        window.dispatchEvent(new CustomEvent('gdc-runtime-control-updated', { detail: { streamId: streamIdNum, action } }))
      } finally {
        setControlBusy(false)
      }
    },
    [controlBusy, runOnceStreamId],
  )

  const executeRunOnce = useCallback(async (streamIdNum: number | null) => {
    if (streamIdNum == null || runOnceStreamId !== null) return
    setRunOnceStreamId(streamIdNum)
    setRunOnceBanner(null)
    setControlMessage(null)
    try {
      const r = await runStreamOnce(streamIdNum)
      const lines = formatRunOnceSummaryLines(r)
      setRunOnceBanner({ variant: 'success', lines })
      setRefreshVersion((v) => v + 1)
      window.dispatchEvent(new CustomEvent('gdc-runtime-run-once', { detail: { streamId: streamIdNum, response: r } }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRunOnceBanner({ variant: 'error', lines: [msg] })
    } finally {
      setRunOnceStreamId(null)
    }
  }, [runOnceStreamId])

  useEffect(() => {
    if (autoRefresh === 'Off') return
    const ms =
      autoRefresh === '5s'
        ? 5000
        : autoRefresh === '15s'
          ? 15_000
          : autoRefresh === '30s'
            ? 30_000
            : autoRefresh === '1m'
              ? 60_000
              : 0
    if (!ms) return
    const id = window.setInterval(() => setRefreshVersion((v) => v + 1), ms)
    return () => window.clearInterval(id)
  }, [autoRefresh])

  useEffect(() => {
    let cancelled = false
    const STREAMS_BOOT_DEADLINE_MS = 25_000
    ;(async () => {
      setStreamsLoading(true)
      setStreamsListError(null)
      try {
        const [dash, streamList] = await Promise.race([
          Promise.all([fetchRuntimeDashboardSummary(100), fetchStreamsList()]),
          new Promise<never>((_, reject) => {
            globalThis.setTimeout(() => {
              reject(
                new Error(
                  '스트림 목록 초기 요청이 제한 시간을 초과했습니다. API 또는 네트워크 상태를 확인한 뒤 새로고침하세요.',
                ),
              )
            }, STREAMS_BOOT_DEADLINE_MS)
          }),
        ])
        if (cancelled) return
        if (dash?.summary) setSectionKpi(streamsSectionKpiFromSummary(dash.summary))

        if (!streamList?.length) {
          setDisplayRows([])
          setWorkflowExtrasByStreamId({})
          setSectionKpi((prev) => ({
            ...prev,
            total: 0,
            totalTrend: 'Live · streams API',
          }))
          return
        }

        const connectorById = new Map<number, string>()
        const connectorIds = [
          ...new Set(streamList.map((s) => s.connector_id).filter((x): x is number => typeof x === 'number')),
        ]
        await Promise.all(
          connectorIds.map(async (cid) => {
            const c = await fetchConnectorById(cid)
            const nm = (c?.name ?? '').trim()
            if (nm) connectorById.set(cid, nm)
          }),
        )
        if (cancelled) return

        const cfgById = new Map<number, Awaited<ReturnType<typeof fetchStreamMappingUiConfig>>>()
        const chunkSize = 8
        for (let i = 0; i < streamList.length; i += chunkSize) {
          const slice = streamList.slice(i, i + chunkSize)
          await Promise.all(
            slice.map(async (s) => {
              const cfg = await fetchStreamMappingUiConfig(s.id)
              cfgById.set(s.id, cfg)
            }),
          )
          if (cancelled) return
        }

        const extras: Record<string, Partial<StreamWorkflowInput>> = {}

        const baseRows = streamList.map((s) => {
          let row = streamReadToConsoleRow(s)
          const cfg = cfgById.get(s.id)
          if (cfg) {
            extras[String(s.id)] = workflowOverridesFromMappingUi(cfg)
            row = mergeMappingUiIntoRow(row, cfg)
          }
          const connLabel = s.connector_id != null ? connectorById.get(s.connector_id) : undefined
          row = mergeConnectorLabelIntoRow(row, connLabel ?? null)
          return row
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
              const bundle = await fetchStreamRuntimeStatsHealth(sid, 80)
              const stats = bundle?.stats ?? null
              const health = bundle?.health ?? null
              return enrichStreamRowWithRuntime(row, stats, health)
            }),
          )
          enrichedRows.push(...part)
          if (cancelled) return
        }
        if (cancelled) return

        setWorkflowExtrasByStreamId(extras)
        setDisplayRows(enrichedRows)
        setSelectedId((prev) => {
          const ids = new Set(streamList.map((s) => String(s.id)))
          if (prev && ids.has(prev)) return prev
          return String(streamList[0]!.id)
        })

        if (!dash?.summary) {
          setSectionKpi((prev) => ({
            ...prev,
            total: streamList.length,
            totalTrend: 'Live · streams API',
          }))
        }
      } catch (e) {
        if (!cancelled) {
          setStreamsListError(e instanceof Error ? e.message : '스트림 목록을 불러오지 못했습니다.')
          setDisplayRows([])
          setWorkflowExtrasByStreamId({})
        }
      } finally {
        if (!cancelled) setStreamsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshVersion])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return displayRows.filter((row) => {
      if (q && !`${row.name} ${row.id} ${row.connectorName}`.toLowerCase().includes(q)) return false
      if (connectorFilter === 'Dev validation lab') {
        if (!isDevValidationLabEntityName(row.name) && !isDevValidationLabEntityName(row.connectorName)) return false
      } else if (connectorFilter !== 'All Connectors' && row.connectorName !== connectorFilter) return false
      if (statusFilter !== 'All Status' && row.status !== statusFilter) return false
      if (sourceFilter !== 'All Sources' && row.sourceTypeLabel !== sourceFilter) return false
      return true
    })
  }, [search, connectorFilter, statusFilter, sourceFilter, displayRows])

  const streamsEmptyMessage = useMemo(() => {
    if (streamsListError) return streamsListError
    if (streamsLoading) return ''
    if (displayRows.length > 0 && filteredRows.length === 0) {
      return 'No streams match the current filters. Try «All Connectors», clear search, or relax status/source filters.'
    }
    return 'No streams returned from the API. For validation-lab streams, run the backend with ENABLE_DEV_VALIDATION_LAB and the lab database; otherwise run scripts/seed.py. If counts differ from curl, check VITE_API_BASE_URL or localStorage gdc.apiBaseUrlOverride (see frontend/README.md).'
  }, [streamsListError, streamsLoading, displayRows.length, filteredRows.length])

  useEffect(() => {
    if (filteredRows.length === 0) return
    if (!filteredRows.some((r) => r.id === selectedId)) {
      setSelectedId(filteredRows[0]?.id ?? '')
    }
  }, [filteredRows, selectedId])

  const resolvedSelectedId = useMemo(
    () => (filteredRows.some((r) => r.id === selectedId) ? selectedId : (filteredRows[0]?.id ?? '')),
    [filteredRows, selectedId],
  )

  const selected = useMemo(() => {
    if (filteredRows.length === 0) return undefined
    return filteredRows.find((r) => r.id === resolvedSelectedId) ?? filteredRows[0]
  }, [filteredRows, resolvedSelectedId])

  const numericSelectedId = useMemo(() => {
    if (!selected) return null
    return /^\d+$/.test(selected.id) ? Number(selected.id) : null
  }, [selected])

  const panelSourceUi = useMemo(() => {
    if (!selected) return resolveSourceTypePresentation('HTTP_API_POLLING')
    const raw = deliveryMapping?.source_type ?? panelStreamRead?.stream_type ?? selected.streamTypeKey
    return resolveSourceTypePresentation(raw)
  }, [selected, deliveryMapping?.source_type, panelStreamRead?.stream_type, selected?.streamTypeKey])

  const selectedOperationalBadges = useMemo(() => {
    if (!selected) return []
    const raw = deliveryMapping?.source_type ?? panelStreamRead?.stream_type ?? selected.streamTypeKey
    return buildOperationalStreamBadges(selected.name, raw)
  }, [selected, deliveryMapping?.source_type, panelStreamRead?.stream_type, selected?.streamTypeKey])

  useEffect(() => {
    if (numericSelectedId == null) {
      setPanelTimeline(null)
      setPanelStats(null)
      setPanelStreamRead(null)
      setPanelDeliveryLogs(null)
      setPanelLogsPage(null)
      setPanelErrorLogs(null)
      setPanelRoutesRows([])
      setDeliveryMapping(null)
      setPanelRuntimeMetrics(null)
      return
    }
    let cancelled = false
    ;(async () => {
      if (detailTab === 'runHistory') {
        setPanelTimelineLoading(true)
        setPanelTimeline(null)
        const t = await fetchStreamRuntimeTimeline(numericSelectedId, { limit: 50 })
        if (!cancelled) {
          setPanelTimeline(t)
          setPanelTimelineLoading(false)
        }
        return
      }
      if (detailTab === 'checkpoint') {
        setPanelStatsLoading(true)
        setPanelStats(null)
        const st = await fetchStreamRuntimeStats(numericSelectedId, 120)
        if (!cancelled) {
          setPanelStats(st)
          setPanelStatsLoading(false)
        }
        return
      }
      if (detailTab === 'metrics') {
        setPanelStatsLoading(true)
        setPanelRuntimeMetrics(null)
        const m = await fetchStreamRuntimeMetrics(numericSelectedId)
        if (!cancelled) {
          setPanelRuntimeMetrics(m)
          setPanelStatsLoading(false)
        }
        return
      }
      if (detailTab === 'configuration') {
        setPanelConfigLoading(true)
        setPanelStreamRead(null)
        const s = await fetchStreamById(numericSelectedId)
        if (!cancelled) {
          setPanelStreamRead(s)
          setPanelConfigLoading(false)
        }
        return
      }
      if (detailTab === 'delivery') {
        setPanelTabLoading(true)
        setDeliveryMapping(null)
        setPanelDeliveryLogs(null)
        const [cfg, logs] = await Promise.all([
          fetchStreamMappingUiConfig(numericSelectedId),
          searchRuntimeDeliveryLogs({ stream_id: numericSelectedId, limit: 40 }),
        ])
        if (!cancelled) {
          setDeliveryMapping(cfg)
          setPanelDeliveryLogs(logs)
          setPanelTabLoading(false)
        }
        return
      }
      if (detailTab === 'errors') {
        setPanelTabLoading(true)
        setPanelErrorLogs(null)
        const logs = await searchRuntimeDeliveryLogs({ stream_id: numericSelectedId, level: 'ERROR', limit: 50 })
        if (!cancelled) {
          setPanelErrorLogs(logs)
          setPanelTabLoading(false)
        }
        return
      }
      if (detailTab === 'logs') {
        setPanelTabLoading(true)
        setPanelLogsPage(null)
        const page = await fetchRuntimeLogsPage({ stream_id: numericSelectedId, limit: 40 })
        if (!cancelled) {
          setPanelLogsPage(page)
          setPanelTabLoading(false)
        }
        return
      }
      if (detailTab === 'routes') {
        setPanelTabLoading(true)
        setPanelRoutesRows([])
        const [routes, destinations] = await Promise.all([fetchRoutesList(), fetchDestinationsList()])
        if (cancelled) return
        const destById = new Map((destinations ?? []).map((d) => [d.id, d]))
        const rows = (routes ?? [])
          .filter((r) => r.stream_id === numericSelectedId)
          .map((route) => ({
            route,
            destination: route.destination_id != null ? destById.get(route.destination_id) ?? null : null,
          }))
        setPanelRoutesRows(rows)
        setPanelTabLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [detailTab, numericSelectedId, refreshVersion])

  const kpiTotalSpark = useMemo(() => {
    const t = Math.max(0, sectionKpi.total)
    return [t, t, t, t, t, t, t] as const
  }, [sectionKpi.total])

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Streams</h2>
        <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Manage and monitor all data streams in real-time.</p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted">
          Rows with limited telemetry may show placeholder metrics — use live API data for operational decisions.
        </p>
      </div>

      {/* KPI row */}
      <section aria-label="Stream KPI summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Streams</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.total}</p>
          <p className="mt-1 text-[11px] font-medium text-violet-700/90 dark:text-violet-300/90">{sectionKpi.totalTrend}</p>
          <div className="mt-1.5 text-violet-600 dark:text-violet-400">
            <MiniSparkline values={kpiTotalSpark} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Running</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Play className="h-3 w-3" aria-hidden />
            </span>
            <p className="text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.running}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{sectionKpi.runningPct}</p>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Degraded</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" aria-hidden />
            </span>
            <p className="text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.degraded}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{sectionKpi.degradedPct}</p>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Error</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10 text-red-700 dark:text-red-300">
              <XCircle className="h-3 w-3" aria-hidden />
            </span>
            <p className="text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.error}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{sectionKpi.errorPct}</p>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Stopped</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/10 text-slate-600 dark:text-gdc-mutedStrong">
              <Square className="h-3 w-3" aria-hidden />
            </span>
            <p className="text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.stopped}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{sectionKpi.stoppedPct}</p>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Events (24h)</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/10 text-sky-800 dark:text-sky-300">
              <BarChart3 className="h-3 w-3" aria-hidden />
            </span>
            <p className="text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{sectionKpi.events24h}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-sky-800/85 dark:text-sky-400/90">{sectionKpi.events24hTrend}</p>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search streams…"
              className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
              aria-label="Search streams in table"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-1 lg:flex-wrap lg:items-center lg:justify-end lg:gap-2">
            <SelectField
              id="streams-filter-connector"
              label="Connector filter"
              value={connectorFilter}
              options={CONNECTOR_FILTER_OPTIONS}
              onChange={setConnectorFilter}
            />
            <SelectField
              id="streams-filter-status"
              label="Status filter"
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={setStatusFilter}
            />
            <SelectField
              id="streams-filter-source"
              label="Source filter"
              value={sourceFilter}
              options={SOURCE_FILTER_OPTIONS}
              onChange={setSourceFilter}
            />
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              <Filter className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              More Filters
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200/70 pt-2 dark:border-gdc-border sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
            <label htmlFor="streams-auto-refresh" className="sr-only">
              Auto refresh interval
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-gdc-muted">Auto refresh</span>
              <div className="relative">
                <select
                  id="streams-auto-refresh"
                  value={autoRefresh}
                  onChange={(e) => {
                    const next = e.target.value as StreamsAutoRefreshOption
                    setAutoRefresh(next)
                    persistStreamsAutoRefresh(next)
                  }}
                  className="h-8 appearance-none rounded-md border border-slate-200/90 bg-white py-1 pl-2 pr-7 text-[12px] font-medium text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                >
                  {AUTO_REFRESH_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o === 'Off' ? 'Off' : `${o}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
              </div>
            </div>
            <Link
              to={newStreamPath()}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New Stream
            </Link>
          </div>
        </div>
      </div>

      {runOnceBanner ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-lg border px-3 py-2 text-[11px] shadow-sm',
            runOnceBanner.variant === 'success'
              ? 'border-emerald-300/80 bg-emerald-500/[0.07] text-emerald-950 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100'
              : 'border-red-300/80 bg-red-500/[0.07] text-red-950 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100',
          )}
        >
          <p className="font-semibold">{runOnceBanner.variant === 'success' ? 'Run once finished' : 'Run once failed'}</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 font-medium opacity-95">
            {runOnceBanner.lines.map((line, i) => (
              <li key={`run-once-${i}-${line.slice(0, 24)}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="overflow-x-auto">
          <table className={opTable}>
            <thead>
              <tr className={opThRow}>
                <th scope="col" className={cn(opTh, 'min-w-[140px]')}>
                  Stream
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[160px]')}>
                  Connector / Source
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[96px]')}>
                  Status
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[120px]')}>
                  Events (1h)
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[130px]')}>
                  Last Checkpoint
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Routes
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Delivery
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Latency (p95)
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[88px]')}>
                  Last Activity
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[220px] text-right')}>
                  Workflow & actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr className={cn(opTr, opStateRow)}>
                  <td className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500 dark:text-gdc-muted')} colSpan={10}>
                    {streamsLoading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Loading streams…
                      </span>
                    ) : (
                      streamsEmptyMessage
                    )}
                  </td>
                </tr>
              ) : null}
              {filteredRows.map((row) => {
                const rowSelected = row.id === resolvedSelectedId
                const workflow = streamWorkflowFromRow(row, workflowExtrasByStreamId[row.id])
                const rowUi = resolveSourceTypePresentation(row.streamTypeKey)
                const runNowExtra = operationalRunControlTooltipSupplement(row.name)
                return (
                  <tr
                    key={row.id}
                    className={cn(opTr, rowSelected ? 'bg-violet-50/80 dark:bg-violet-500/[0.07]' : undefined)}
                  >
                    <td className={opTd}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(row.id)
                          setDetailTab('configuration')
                        }}
                        className="w-full text-left"
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="block text-[12px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
                          <DevValidationBadge name={row.name} />
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-gdc-muted">{row.id}</span>
                      </button>
                    </td>
                    <td className={opTd}>
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-gdc-elevated">
                          <Workflow className="h-3.5 w-3.5 text-slate-600 dark:text-gdc-mutedStrong" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">{row.connectorName}</p>
                          <p className="truncate text-[11px] text-slate-500 dark:text-gdc-muted">{row.sourceTypeLabel}</p>
                        </div>
                      </div>
                    </td>
                    <td className={opTd}>
                      <StatusBadge tone={statusTone(row.status)} className="font-bold uppercase tracking-wide">
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className={opTd}>
                      {!row.hasRuntimeApiSnapshot ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No runtime data yet</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                            {row.events1h.toLocaleString()}
                          </span>
                          <span className={eventsSparklineClass(row.status)}>
                            <MiniSparkline values={row.eventsTrend} />
                          </span>
                        </div>
                      )}
                    </td>
                    <td className={opTd}>
                      {!row.hasRuntimeApiSnapshot ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No runtime data yet</span>
                      ) : (
                        <>
                          <p className="text-[11px] font-medium text-slate-800 dark:text-slate-200">{row.lastCheckpointDisplay}</p>
                          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{row.lastCheckpointRelative}</p>
                        </>
                      )}
                    </td>
                    <td className={opTd}>
                      <RouteFanOut row={row} />
                    </td>
                    <td className={opTd}>
                      {!row.hasRuntimeApiSnapshot ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No runtime data yet</span>
                      ) : (
                        <DeliveryMeter pct={row.deliveryPct} />
                      )}
                    </td>
                    <td className={opTd}>
                      {!row.hasRuntimeApiSnapshot ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No runtime data yet</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                            {row.latencyP95Ms > 0 ? `${row.latencyP95Ms} ms` : '—'}
                          </span>
                          <span className="text-slate-400 dark:text-gdc-muted">
                            <MiniSparkline values={row.latencyTrend} />
                          </span>
                        </div>
                      )}
                    </td>
                    <td className={opTd}>
                      {!row.hasRuntimeApiSnapshot ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No runtime data yet</span>
                      ) : (
                        <span
                          className={cn(
                            'text-[12px] font-semibold tabular-nums',
                            row.lastActivityWarn ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200',
                          )}
                        >
                          {row.lastActivityRelative}
                        </span>
                      )}
                    </td>
                    <td className={cn(opTd, 'text-right')}>
                      <div
                        className="inline-flex max-w-[280px] flex-wrap items-center justify-end gap-0.5"
                        title={rowUi.runtime.operationsWorkflowTooltip}
                      >
                        <StreamWorkflowProgressBadge
                          snapshot={workflow}
                          className="mr-1"
                          ariaLabel={`Continue setup: ${row.name}`}
                        />
                        <Link
                          to={streamApiTestPath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-sky-500/10 hover:text-sky-800 dark:text-gdc-mutedStrong dark:hover:bg-sky-500/15 dark:hover:text-sky-200"
                          aria-label={`${rowUi.runtime.operationsTestIconAriaLabelPrefix}: ${row.name}`}
                          title={rowUi.runtime.operationsTestIconTitle}
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          to={streamMappingPath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-violet-500/10 hover:text-violet-800 dark:text-gdc-mutedStrong dark:hover:bg-violet-500/15 dark:hover:text-violet-200"
                          aria-label={`Field mapping: ${row.name}`}
                          title="Mapping"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          to={streamEnrichmentPath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-gdc-mutedStrong dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200"
                          aria-label={`Enrichment: ${row.name}`}
                          title="Enrichment"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          to={streamRuntimePath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                          aria-label={`Runtime detail: ${row.name}`}
                          title="Runtime"
                        >
                          <Cpu className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          to={streamEditPath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                          aria-label={`Edit stream: ${row.name}`}
                          title="Edit stream"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          to={logsPath(row.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                          aria-label={`Stream logs: ${row.name}`}
                          title="Logs"
                        >
                          <ScrollText className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          type="button"
                          disabled={!/^\d+$/.test(row.id) || controlBusy || runOnceStreamId !== null}
                          onClick={() => void executeRunOnce(Number(row.id))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                          aria-label={`Run now: ${row.name}`}
                          title={runNowExtra ? `Run now (execute pipeline once). ${runNowExtra}` : 'Run now (execute pipeline once)'}
                        >
                          {runOnceStreamId === Number(row.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Play className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
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
            Showing {filteredRows.length} stream{filteredRows.length === 1 ? '' : 's'} (total {sectionKpi.total})
          </p>
        </div>
      </div>

      {selected ? (
        <aside
          role="region"
          aria-label="Selected stream detail"
          className="mt-2 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-3 shadow-sm dark:border-gdc-border dark:bg-gdc-section"
        >
          <div className="w-full min-w-0 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Selected stream</p>
                <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                  {selected.name}{' '}
                  <span className="font-normal text-slate-500 dark:text-gdc-muted">({selected.id})</span>
                </p>
                <StreamOperationalBadges badges={selectedOperationalBadges} className="mt-0.5" />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {DETAIL_TABS.map((t) => {
                  const label = t.key === 'delivery' ? `${t.label} (${selected.routesTotal})` : t.label
                  const active = detailTab === t.key
                  const tabCls = cn(
                    'whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                    active
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
                  )
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setDetailTab(t.key)}
                      className={tabCls}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {controlMessage ? (
              <p className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">{controlMessage}</p>
            ) : null}

            {runOnceBanner ? (
              <div
                role="status"
                className={cn(
                  'rounded-md border px-2 py-1.5 text-[11px]',
                  runOnceBanner.variant === 'success'
                    ? 'border-emerald-300/70 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                    : 'border-red-300/70 bg-red-500/[0.06] text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
                )}
              >
                <p className="font-semibold">{runOnceBanner.variant === 'success' ? 'Last run once' : 'Run once error'}</p>
                <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                  {runOnceBanner.lines.map((line, i) => (
                    <li key={`aside-run-${i}-${line.slice(0, 20)}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(() => {
              const workflow = streamWorkflowFromRow(selected, workflowExtrasByStreamId[selected.id])
              return <StreamWorkflowChecklist snapshot={workflow} showRuntimeLinks />
            })()}

            {detailTab === 'configuration' ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
                {panelConfigLoading ? (
                  <p className="flex items-center gap-2 text-[11px] text-slate-500 lg:col-span-12 dark:text-gdc-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Loading stream entity from API…
                  </p>
                ) : null}
                <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card lg:col-span-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Stream Info</h3>
                  <dl className="mt-2 space-y-1.5 text-[12px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-gdc-muted">Stream ID</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">{selected.id}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-gdc-muted">Type</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">
                        {(panelStreamRead?.stream_type ?? selected.streamType).replace(/_/g, ' ')}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-gdc-muted">Polling Interval</dt>
                      <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {(panelStreamRead?.polling_interval ?? selected.pollingIntervalSec) ?? '—'} sec
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-gdc-muted">Created At</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">{selected.createdAt}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-gdc-muted">Created By</dt>
                      <dd className="truncate font-medium text-slate-900 dark:text-slate-100">{selected.createdBy}</dd>
                    </div>
                    {panelStreamRead ? (
                      <>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Entity status</dt>
                          <dd className="font-medium text-slate-900 dark:text-slate-100">{panelStreamRead.status ?? '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Enabled</dt>
                          <dd className="font-medium text-slate-900 dark:text-slate-100">
                            {panelStreamRead.enabled == null ? '—' : panelStreamRead.enabled ? 'yes' : 'no'}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </section>

                <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card lg:col-span-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                    {panelSourceUi.runtime.sourceSectionTitle}
                  </h3>
                  <div className="mt-2 space-y-2 text-[12px]">
                    {panelSourceUi.key === 'HTTP_API_POLLING' ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-px text-[10px] font-bold text-emerald-900 dark:text-emerald-100/90">
                            {selected.sourceMethod}
                          </span>
                          <span className="break-all font-mono text-[11px] text-slate-800 dark:text-slate-200">{selected.sourceUrl}</span>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-3">
                          <p>
                            <span className="text-slate-500 dark:text-gdc-muted">Auth</span>{' '}
                            <span className="font-medium text-slate-900 dark:text-slate-100">{selected.authType}</span>
                          </p>
                          <p>
                            <span className="text-slate-500 dark:text-gdc-muted">Timeout</span>{' '}
                            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{selected.timeoutSec} sec</span>
                          </p>
                          <p className="sm:col-span-1">
                            <span className="text-slate-500 dark:text-gdc-muted">Rate limit</span>{' '}
                            <span className="font-medium text-slate-900 dark:text-slate-100">{selected.rateLimitLabel}</span>
                          </p>
                        </div>
                      </>
                    ) : panelSourceUi.key === 'REMOTE_FILE_POLLING' ? (
                      <dl className="space-y-1.5">
                        {(
                          [
                            ['Remote directory', (panelStreamRead?.config_json as Record<string, unknown>)?.remote_directory],
                            ['File pattern', (panelStreamRead?.config_json as Record<string, unknown>)?.file_pattern],
                            ['Parser type', (panelStreamRead?.config_json as Record<string, unknown>)?.parser_type],
                          ] as const
                        ).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <dt className="shrink-0 text-slate-500 dark:text-gdc-muted">{k}</dt>
                            <dd className="truncate text-right font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                              {v != null && String(v).trim() !== '' ? String(v) : '—'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : panelSourceUi.key === 'DATABASE_QUERY' ? (
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Checkpoint mode</dt>
                          <dd className="font-medium text-slate-900 dark:text-slate-100">
                            {String((panelStreamRead?.config_json as Record<string, unknown>)?.checkpoint_mode ?? '—')}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Checkpoint column</dt>
                          <dd className="truncate font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                            {String((panelStreamRead?.config_json as Record<string, unknown>)?.checkpoint_column ?? '—')}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-1">
                          <dt className="text-slate-500 dark:text-gdc-muted">SQL query</dt>
                          <dd className="max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-800 dark:text-slate-200">
                            {(() => {
                              const q = (panelStreamRead?.config_json as Record<string, unknown>)?.query
                              const s = typeof q === 'string' ? q : ''
                              if (!s.trim()) return '—'
                              return s.length > 400 ? `${s.slice(0, 400)}…` : s
                            })()}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <dl className="space-y-1.5">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Bucket</dt>
                          <dd className="truncate font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                            {String((deliveryMapping?.source_config as Record<string, unknown> | undefined)?.bucket ?? '—')}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Prefix</dt>
                          <dd className="truncate font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                            {(() => {
                              const px = (deliveryMapping?.source_config as Record<string, unknown> | undefined)?.prefix
                              const t = px != null ? String(px) : ''
                              return t.trim() === '' ? '(root)' : t
                            })()}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Max objects / run</dt>
                          <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                            {String((panelStreamRead?.config_json as Record<string, unknown>)?.max_objects_per_run ?? '—')}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-gdc-muted">Object parser</dt>
                          <dd className="font-medium text-slate-900 dark:text-slate-100">
                            {(panelStreamRead?.config_json as Record<string, unknown>)?.strict_json_lines === true
                              ? 'Strict JSON lines'
                              : 'Lenient NDJSON'}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card lg:col-span-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Latest Checkpoint</h3>
                  {!selected.hasRuntimeApiSnapshot ? (
                    <p className="mt-2 text-[12px] text-slate-500 dark:text-gdc-muted">No runtime data yet</p>
                  ) : (
                    <>
                      <p className="mt-2 break-all font-mono text-[11px] text-slate-800 dark:text-slate-200">{selected.checkpointValue}</p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted">Updated {selected.checkpointUpdatedAt}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-gdc-mutedStrong">Lag: {selected.checkpointLagLabel}</p>
                    </>
                  )}
                  <Link
                    to={streamRuntimePath(selected.id)}
                    className="mt-2 inline-flex h-7 items-center justify-center rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                  >
                    View runtime
                  </Link>
                </section>

                <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card lg:col-span-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Quick Actions</h3>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Link
                      to={streamApiTestPath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-sky-200/90 bg-sky-500/[0.06] px-2 text-left text-[12px] font-semibold text-sky-950 hover:bg-sky-500/10 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100 dark:hover:bg-sky-500/15"
                    >
                      <FlaskConical className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" aria-hidden />
                      {panelSourceUi.runtime.quickActionsTestLabel}
                    </Link>
                    <Link
                      to={streamMappingPath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" aria-hidden />
                      Field mapping
                    </Link>
                    <Link
                      to={streamEnrichmentPath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" aria-hidden />
                      Enrichment
                    </Link>
                    <Link
                      to={streamRuntimePath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200/80 bg-violet-500/[0.06] px-2 text-left text-[12px] font-semibold text-violet-900 hover:bg-violet-500/10 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/15"
                    >
                      <Cpu className="h-3.5 w-3.5 text-violet-700 dark:text-violet-300" aria-hidden />
                      Runtime inspector
                    </Link>
                    <Link
                      to={logsPath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      <ScrollText className="h-3.5 w-3.5 text-slate-600 dark:text-gdc-mutedStrong" aria-hidden />
                      Stream logs
                    </Link>
                    <button
                      type="button"
                      disabled={numericSelectedId == null || controlBusy || runOnceStreamId !== null}
                      onClick={() => void executeRunOnce(numericSelectedId)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      {runOnceStreamId === numericSelectedId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400" aria-hidden />
                      ) : (
                        <Play className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      )}
                      Run Now
                    </button>
                    <button
                      type="button"
                      disabled={numericSelectedId == null || controlBusy}
                      onClick={() => void runStreamControl(numericSelectedId, 'stop')}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      <Pause className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                      Pause Stream
                    </button>
                    <Link
                      to={streamEditPath(selected.id)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
                    >
                      <Pencil className="h-3.5 w-3.5 text-slate-600 dark:text-gdc-mutedStrong" aria-hidden />
                      Edit Stream
                    </Link>
                    <button
                      type="button"
                      disabled={numericSelectedId == null || controlBusy}
                      onClick={() => void runStreamControl(numericSelectedId, 'stop')}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-red-500/20 bg-red-500/[0.06] px-2 text-left text-[12px] font-semibold text-red-800 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/15"
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden />
                      Stop Stream
                    </button>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card md:col-span-2 lg:col-span-12">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Recent Errors (last 5)</h3>
                    <Link
                      to={logsPath(selected.id)}
                      className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                    >
                      View all in logs
                    </Link>
                  </div>
                  {selected.recentErrors.length === 0 ? (
                    <p className="mt-2 text-[12px] text-slate-600 dark:text-gdc-muted">No recent delivery errors for this stream.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {selected.recentErrors.slice(0, 5).map((err, i) => (
                        <li key={`${err.message}-${i}`} className="flex items-start gap-2 rounded-md border border-slate-200/70 bg-white/80 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100">{err.message}</p>
                            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{err.relativeAt}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {panelStreamRead ? (
                  <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card lg:col-span-12">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                      config_json (streams API)
                    </h3>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-200/80 bg-white/90 p-2 font-mono text-[10px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
                      {JSON.stringify(panelStreamRead.config_json ?? {}, null, 2)}
                    </pre>
                  </section>
                ) : numericSelectedId != null && !panelConfigLoading ? (
                  <p className="text-[12px] text-slate-500 lg:col-span-12 dark:text-gdc-muted">
                    Stream entity not available from API yet.
                  </p>
                ) : null}
              </div>
            ) : detailTab === 'runHistory' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Run history (delivery_logs timeline)
                </h3>
                {panelTimelineLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading timeline…
                  </p>
                ) : panelTimeline?.items?.length ? (
                  <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
                    {panelTimeline.items.map((it) => (
                      <li
                        key={it.id}
                        className="rounded-md border border-slate-200/80 bg-white/90 px-3 py-2 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
                      >
                        <span className="font-mono text-slate-500 dark:text-slate-400">{it.created_at}</span>{' '}
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{it.stage}</span> · {it.level}
                        <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-300">{it.message}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">No runtime data yet</p>
                )}
              </div>
            ) : detailTab === 'delivery' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Delivery</h3>
                {panelTabLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading…
                  </p>
                ) : (
                  <>
                    <h4 className="mt-3 text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">Routes (mapping-ui)</h4>
                    {!deliveryMapping ? (
                      <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">Unable to load mapping configuration.</p>
                    ) : deliveryMapping.routes.length === 0 ? (
                      <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">No routes configured for this stream.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {deliveryMapping.routes.map((r) => (
                          <li
                            key={r.route_id}
                            className="rounded-md border border-slate-200/80 bg-white/90 px-3 py-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
                          >
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {r.destination_name ?? `Destination #${r.destination_id}`}{' '}
                              <span className="font-normal text-slate-500 dark:text-gdc-muted">({r.destination_type ?? '—'})</span>
                            </p>
                            <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                              route #{r.route_id} · {r.route_enabled && r.destination_enabled ? 'enabled' : 'disabled'} ·{' '}
                              {r.failure_policy}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <h4 className="mt-4 text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">Recent delivery logs</h4>
                    {!panelDeliveryLogs ? (
                      <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">Unable to load delivery logs.</p>
                    ) : panelDeliveryLogs.logs.length === 0 ? (
                      <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">No delivery log rows in this window.</p>
                    ) : (
                      <ul className="mt-2 max-h-56 space-y-2 overflow-auto">
                        {panelDeliveryLogs.logs.map((log) => (
                          <li
                            key={log.id}
                            className="rounded-md border border-slate-200/80 bg-white/90 px-3 py-2 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
                          >
                            <span className="font-mono text-slate-500 dark:text-slate-400">{log.created_at}</span>
                            <span className="text-slate-700 dark:text-slate-200">
                              {' '}
                              · {log.stage} · {log.level}
                            </span>
                            <p className="mt-1 break-words text-slate-700 dark:text-slate-300">{log.message}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ) : detailTab === 'checkpoint' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Checkpoint</h3>
                {panelStatsLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading stats…
                  </p>
                ) : panelStats?.checkpoint ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                      Type: {String(panelStats.checkpoint.type ?? '')}
                    </p>
                    <pre className="overflow-auto rounded-md border border-slate-200/80 bg-white/90 p-3 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
                      {formatCheckpointValueForConsole((panelStats.checkpoint.value ?? {}) as Record<string, unknown>)}
                    </pre>
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">No runtime data yet</p>
                )}
              </div>
            ) : detailTab === 'routes' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Routes</h3>
                {panelTabLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading routes…
                  </p>
                ) : panelRoutesRows.length === 0 ? (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">No routes found for this stream.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {panelRoutesRows.map(({ route, destination }) => (
                      <li
                        key={route.id}
                        className="rounded-md border border-slate-200/80 bg-white/90 px-3 py-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
                      >
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          Route #{route.id} ·{' '}
                          {destination?.name?.trim() ||
                            (route.destination_id != null ? `Destination #${route.destination_id}` : '—')}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                          {destination?.destination_type ?? '—'} · failure_policy: {route.failure_policy ?? '—'} · enabled:{' '}
                          {route.enabled === false ? 'no' : 'yes'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : detailTab === 'logs' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Logs</h3>
                  <Link
                    to={logsPath(selected.id)}
                    className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                  >
                    Open logs explorer
                  </Link>
                </div>
                {panelTabLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading…
                  </p>
                ) : panelLogsPage?.items?.length ? (
                  <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
                    {panelLogsPage.items.map((log) => (
                      <li
                        key={`${log.created_at}-${log.id}`}
                        className="rounded-md border border-slate-200/80 bg-white/90 px-3 py-2 text-[11px] dark:border-gdc-border dark:bg-gdc-section"
                      >
                        <span className="font-mono text-slate-500">{log.created_at}</span> · {log.stage} · {log.level}
                        <p className="mt-1 text-slate-700 dark:text-gdc-mutedStrong">{log.message}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">No runtime data yet</p>
                )}
              </div>
            ) : detailTab === 'errors' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Errors</h3>
                {panelTabLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading…
                  </p>
                ) : panelErrorLogs?.logs?.length ? (
                  <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
                    {panelErrorLogs.logs.map((log) => (
                      <li
                        key={log.id}
                        className="rounded-md border border-red-200/60 bg-white/90 px-3 py-2 text-[11px] dark:border-red-500/20 dark:bg-gdc-section"
                      >
                        <span className="font-mono text-slate-500">{log.created_at}</span> · {log.stage}
                        <p className="mt-1 text-slate-800 dark:text-slate-200">{log.message}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">No ERROR-level rows in this window.</p>
                )}
              </div>
            ) : detailTab === 'metrics' ? (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-gdc-border dark:bg-gdc-card">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Runtime metrics
                </h3>
                <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-muted">GET /api/v1/runtime/streams/&#123;id&#125;/metrics</p>
                {panelStatsLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading metrics…
                  </p>
                ) : panelRuntimeMetrics ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded border border-slate-200/80 bg-white/90 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
                        <p className="font-medium text-slate-500">Events (1h)</p>
                        <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {panelRuntimeMetrics.kpis.events_last_hour.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded border border-slate-200/80 bg-white/90 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
                        <p className="font-medium text-slate-500">Delivery %</p>
                        <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {panelRuntimeMetrics.kpis.delivery_success_rate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="rounded border border-slate-200/80 bg-white/90 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
                        <p className="font-medium text-slate-500">Avg latency</p>
                        <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {Math.round(panelRuntimeMetrics.kpis.avg_latency_ms)} ms
                        </p>
                      </div>
                      <div className="rounded border border-slate-200/80 bg-white/90 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
                        <p className="font-medium text-slate-500">Routes</p>
                        <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {panelRuntimeMetrics.route_health.length}
                        </p>
                      </div>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-md border border-slate-200/80 bg-white/90 p-2 font-mono text-[10px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
                      {JSON.stringify(panelRuntimeMetrics.kpis, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-slate-600 dark:text-gdc-muted">Metrics unavailable or empty.</p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Select a tab.</p>
            )}
          </div>
        </aside>
      ) : null}

      <p className="flex items-center gap-2 border-t border-slate-200/70 pt-2 text-[10px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
        <Activity className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        Streams list from GET /streams/, runtime stats/health per stream, dashboard summary when available, mapping-ui
        config, and connector names from the API. Run Now calls the runtime run-once endpoint for the selected stream id.
      </p>
    </div>
  )
}
