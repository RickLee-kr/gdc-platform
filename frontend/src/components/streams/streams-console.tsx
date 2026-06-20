import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  LayoutGrid,
  LayoutList,
  Loader2,
  MinusCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  Sparkles,
  Wand2,
  Workflow,
  XCircle,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { computeFixedRowVirtualRange } from '../../lib/fixed-row-virtual-window'
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
  fetchStreamMappingUiConfig,
  fetchStreamRuntimeStatsHealth,
  runStreamOnce,
} from '../../api/gdcRuntime'
import { fetchConnectorById } from '../../api/gdcConnectors'
import { fetchDestinationsList } from '../../api/gdcDestinations'
import { fetchRoutesList } from '../../api/gdcRoutes'
import { fetchStreamsListResult, GDC_AUTH_REQUIRED_MESSAGE } from '../../api/gdcStreams'
import { createRefreshCycleSnapshotId } from '../../api/runtimeSnapshotSync'
import {
  enrichStreamRowWithRuntime,
  mergeConnectorIntoRow,
  type ConnectorRowMetadata,
  mergeMappingUiIntoRow,
  streamReadToConsoleRow,
  type StreamConsoleRow,
  type StreamRuntimeStatus,
} from '../../api/streamRows'
import { computeStreamWorkflow, type StreamWorkflowInput, type StreamWorkflowSnapshot } from '../../utils/streamWorkflow'
import { workflowOverridesFromMappingUi } from '../../utils/mappingUiWorkflow'
import { resolveSourceTypePresentation } from '../../utils/sourceTypePresentation'
import { streamsSectionKpiFromSummary, type StreamsSectionKpi } from '../../api/streamsKpi'
import { StreamWorkflowProgressBadge } from './stream-workflow-checklist'
import { groupRowsBySourceProduct } from '../../lib/source-product-group'
import {
  aggregateGroupIssueBreakdown,
  aggregateGroupRates,
  aggregateGroupSparklines,
  computeStreamsPageKpi,
  deliveryRateLabel,
  formatSuccessRate,
  groupHealthLabel,
  groupHealthTone,
  groupLastEventLabel,
  ingestRateLabel,
  successRateTone,
  type GroupHealthLabel,
} from '../../lib/stream-console-metrics'
import { deriveConsoleRowIssueSummaries } from '../../lib/stream-governance-snapshot'
import { effectiveStreamSeverity, operationalSeverityIcon } from '../../lib/stream-operational-status'
import { StreamsGroupKpiStrip } from './streams-group-kpi-strip'
import { StreamsOperationsSummaryStrip } from './streams-operations-summary-strip'
import { StreamsOperationsToolbar } from './streams-operations-toolbar'
import { StreamsProblemPanel } from './streams-problem-panel'
import {
  buildProblemStreamItems,
  computeStreamOperationsSummary,
  filterStreamRows,
  productGroupOptions,
  sortGroupsProblemFirst,
  sortStreamsProblemFirst,
  type StreamsQuickFilter,
} from '../../lib/streams-console-operations'
import { isDevValidationLabUiEnabled } from '../../lib/feature-flags'
import { operationalRunControlTooltipSupplement } from '../../utils/streamOperationalBadges'
import { DevValidationBadge } from '../shell/dev-validation-badge'
import { loadStreamsAutoRefresh, type StreamsAutoRefreshOption } from '../../localPreferences'
import type { StreamRead } from '../../api/types/gdcApi'
import { readStreamsConsoleSnapshot, writeStreamsConsoleSnapshot, clearStreamsConsoleSnapshot } from './streams-console-cache'

const STREAMS_ENRICH_CONCURRENCY = 12

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return []
  const limit = Math.max(1, concurrency)
  const out: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      out[i] = await mapper(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

async function enrichStreamConsoleRows(
  streamList: StreamRead[],
  gen: number,
  loadGenRef: MutableRefObject<number>,
  isCancelled: () => boolean,
  setters: {
    setDisplayRows: Dispatch<SetStateAction<StreamConsoleRow[]>>
    setWorkflowExtrasByStreamId: Dispatch<SetStateAction<Record<string, Partial<StreamWorkflowInput>>>>
  },
): Promise<void> {
  const isCurrent = () => !isCancelled() && loadGenRef.current === gen

  const connectorById = new Map<number, ConnectorRowMetadata>()
  const connectorIds = [
    ...new Set(streamList.map((s) => s.connector_id).filter((x): x is number => typeof x === 'number')),
  ]
  await mapWithConcurrency(connectorIds, STREAMS_ENRICH_CONCURRENCY, async (cid) => {
    const c = await fetchConnectorById(cid)
    if (!c) return
    const nm = (c.name ?? '').trim()
    const pg = (c.product_group ?? '').trim() || null
    if (nm || pg) connectorById.set(cid, { name: nm || null, product_group: pg })
  })
  if (!isCurrent()) return

  const cfgPairs = await mapWithConcurrency(streamList, STREAMS_ENRICH_CONCURRENCY, async (s) => {
    try {
      const cfg = await fetchStreamMappingUiConfig(s.id)
      return [s.id, cfg] as const
    } catch {
      return [s.id, null] as const
    }
  })
  if (!isCurrent()) return

  const cfgById = new Map<number, Awaited<ReturnType<typeof fetchStreamMappingUiConfig>>>()
  for (const [id, cfg] of cfgPairs) {
    if (cfg != null) cfgById.set(id, cfg)
  }

  const extras: Record<string, Partial<StreamWorkflowInput>> = {}
  const baseRows = streamList.map((s) => {
    let row = streamReadToConsoleRow(s)
    const cfg = cfgById.get(s.id)
    if (cfg) {
      extras[String(s.id)] = workflowOverridesFromMappingUi(cfg)
      row = mergeMappingUiIntoRow(row, cfg)
    }
    const connMeta = s.connector_id != null ? connectorById.get(s.connector_id) : undefined
    row = mergeConnectorIntoRow(row, connMeta ?? null)
    return row
  })

  setters.setWorkflowExtrasByStreamId(extras)
  setters.setDisplayRows(baseRows)
  if (!isCurrent()) return

  const enrichedRows = await mapWithConcurrency(baseRows, STREAMS_ENRICH_CONCURRENCY, async (row) => {
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
  })
  if (!isCurrent()) return

  setters.setDisplayRows(enrichedRows)
}

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

function GroupHealthBadge({ label, tone }: { label: GroupHealthLabel; tone: ReturnType<typeof groupHealthTone> }) {
  const Icon =
    label === 'Healthy'
      ? CheckCircle2
      : label === 'Warning'
        ? AlertTriangle
        : label === 'Critical'
          ? XCircle
          : MinusCircle
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
        : tone === 'error'
          ? 'border-red-500/40 bg-red-500/10 text-red-400'
          : 'border-slate-500/40 bg-slate-500/10 text-slate-400'
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', toneClass)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
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
    processedEvents: '—',
    processedEventsTrend: '—',
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

const STREAMS_CONSOLE_ROW_HEIGHT = 56
const STREAMS_CONSOLE_VIRTUALIZE_MIN = 50
const STREAMS_CONSOLE_VIRTUAL_VIEWPORT = 560

const streamsGroupTableThClass =
  'px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-mutedStrong'

const streamsGroupTableTdClass = 'px-3 py-3 align-middle text-[12px] text-slate-700 dark:text-gdc-mutedStrong'

function StreamSeverityIcon({ row }: { row: StreamConsoleRow }) {
  const severity = effectiveStreamSeverity(row)
  const kind = operationalSeverityIcon(severity)
  if (kind === 'critical') return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
  if (kind === 'warn') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
  if (kind === 'stopped') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
}

function StreamStatusBadge({ status }: { status: StreamRuntimeStatus }) {
  const tone = statusTone(status)
  const toneClass =
    tone === 'success'
      ? 'border-emerald-600/50 bg-emerald-950/80 text-emerald-400'
      : tone === 'warning'
        ? 'border-amber-600/50 bg-amber-950/80 text-amber-400'
        : tone === 'error'
          ? 'border-red-600/50 bg-red-950/80 text-red-400'
          : 'border-slate-600/50 bg-slate-900/80 text-slate-400'
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', toneClass)}>
      {status}
    </span>
  )
}

function streamRowHighlightClass(row: StreamConsoleRow): string {
  const severity = effectiveStreamSeverity(row)
  if (severity === 'critical') return 'bg-red-500/[0.04] dark:bg-red-500/[0.06]'
  if (severity === 'warning') return 'bg-amber-500/[0.05] dark:bg-amber-500/[0.07]'
  return 'bg-slate-50/40 dark:bg-gdc-elevated/30'
}

export function StreamsConsole() {
  const cachedSnapshot = readStreamsConsoleSnapshot()
  const [displayRows, setDisplayRows] = useState<StreamConsoleRow[]>(() => cachedSnapshot?.displayRows ?? [])
  const [autoRefresh, setAutoRefresh] = useState<StreamsAutoRefreshOption>('Off')
  useLayoutEffect(() => {
    setAutoRefresh(loadStreamsAutoRefresh())
  }, [])
  const [sectionKpi, setSectionKpi] = useState<StreamsSectionKpi>(
    () => cachedSnapshot?.sectionKpi ?? emptyStreamsKpi(),
  )
  const [streamsLoading, setStreamsLoading] = useState(() => (cachedSnapshot?.displayRows.length ?? 0) === 0)
  const [streamsListError, setStreamsListError] = useState<string | null>(null)
  const [streamsAuthRequired, setStreamsAuthRequired] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const [expandedProductGroups, setExpandedProductGroups] = useState<Set<string>>(() => {
    const params = new URLSearchParams(location.search)
    const label = params.get('expand_group')?.trim()
    return label ? new Set([label]) : new Set()
  })
  const [workflowExtrasByStreamId, setWorkflowExtrasByStreamId] = useState<
    Record<string, Partial<StreamWorkflowInput>>
  >(() => cachedSnapshot?.workflowExtrasByStreamId ?? {})
  const [refreshVersion, setRefreshVersion] = useState(0)
  const loadGenRef = useRef(0)
  const hasLoadedOnceRef = useRef((cachedSnapshot?.displayRows.length ?? 0) > 0)
  const [runOnceStreamId, setRunOnceStreamId] = useState<number | null>(null)
  const [runOnceBanner, setRunOnceBanner] = useState<{ variant: 'success' | 'error'; lines: string[] } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState<StreamsQuickFilter>('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [destinationLabelsByStreamId, setDestinationLabelsByStreamId] = useState<Map<number, string[]>>(new Map())
  const groupRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const highlightedGroupLabel = useMemo(
    () => new URLSearchParams(location.search).get('expand_group')?.trim() ?? null,
    [location.search],
  )
  const executeRunOnce = useCallback(async (streamIdNum: number | null) => {
    if (streamIdNum == null || runOnceStreamId !== null) return
    setRunOnceStreamId(streamIdNum)
    setRunOnceBanner(null)
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
    if (displayRows.length === 0) return
    writeStreamsConsoleSnapshot({ displayRows, workflowExtrasByStreamId, sectionKpi })
  }, [displayRows, workflowExtrasByStreamId, sectionKpi])

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
    setRefreshVersion((v) => v + 1)
  }, [location.key])

  useEffect(() => {
    const gen = ++loadGenRef.current
    let cancelled = false
    const showFullScreenLoader = displayRows.length === 0
    const snapshot_id = createRefreshCycleSnapshotId()

    ;(async () => {
      if (showFullScreenLoader) setStreamsLoading(true)
      setStreamsListError(null)
      setStreamsAuthRequired(false)

      void fetchRuntimeDashboardSummary(100, '24h', { snapshot_id })
        .then((dash) => {
          if (cancelled || loadGenRef.current !== gen) return
          if (dash?.summary) setSectionKpi(streamsSectionKpiFromSummary(dash.summary, dash.metric_meta))
        })
        .catch(() => {
          /* Dashboard KPI failure must not hide streams */
        })

      try {
        const listResult = await fetchStreamsListResult()
        if (cancelled || loadGenRef.current !== gen) return

        if (listResult.ok === false) {
          clearStreamsConsoleSnapshot()
          setStreamsAuthRequired(listResult.authRequired)
          setStreamsListError(listResult.message)
          setDisplayRows([])
          setWorkflowExtrasByStreamId({})
          return
        }

        const streamList = listResult.data

        if (!streamList.length) {
          setDisplayRows([])
          setWorkflowExtrasByStreamId({})
          setSectionKpi((prev) => ({
            ...prev,
            total: 0,
            totalTrend: 'Live · streams API',
          }))
          return
        }

        const quickRows = streamList.map((s) => streamReadToConsoleRow(s))
        setDisplayRows(quickRows)
        setStreamsLoading(false)
        hasLoadedOnceRef.current = true
        setSectionKpi((prev) => ({
          ...prev,
          total: streamList.length,
          totalTrend: 'Live · streams API',
        }))

        void enrichStreamConsoleRows(streamList, gen, loadGenRef, () => cancelled, {
          setDisplayRows,
          setWorkflowExtrasByStreamId,
        })
      } catch (e) {
        if (loadGenRef.current === gen) {
          setStreamsListError(e instanceof Error ? e.message : 'Failed to load streams.')
          if (!hasLoadedOnceRef.current) {
            setDisplayRows([])
            setWorkflowExtrasByStreamId({})
          }
        }
      } finally {
        if (loadGenRef.current === gen) {
          setStreamsLoading(false)
          hasLoadedOnceRef.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshVersion])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [routes, destinations] = await Promise.all([fetchRoutesList(), fetchDestinationsList()])
      if (cancelled) return
      const destNameById = new Map<number, string>()
      for (const d of destinations ?? []) {
        destNameById.set(d.id, (d.name ?? '').trim() || `Destination #${d.id}`)
      }
      const byStream = new Map<number, Set<string>>()
      for (const route of routes ?? []) {
        const sid = route.stream_id
        if (sid == null || !Number.isFinite(sid)) continue
        const names = byStream.get(sid) ?? new Set<string>()
        if (route.destination_id != null) {
          const label = destNameById.get(route.destination_id)
          if (label) names.add(label)
        }
        const routeName = (route.name ?? '').trim()
        if (routeName) names.add(routeName)
        byStream.set(sid, names)
      }
      const out = new Map<number, string[]>()
      for (const [sid, names] of byStream) out.set(sid, [...names].sort((a, b) => a.localeCompare(b)))
      setDestinationLabelsByStreamId(out)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshVersion])

  const filteredRows = useMemo(
    () =>
      filterStreamRows({
        rows: displayRows,
        searchQuery,
        quickFilter,
        groupFilter,
        destinationLabelsByStreamId,
      }),
    [displayRows, searchQuery, quickFilter, groupFilter, destinationLabelsByStreamId],
  )

  const productGroups = useMemo(() => {
    const groups = groupRowsBySourceProduct(filteredRows)
    return sortGroupsProblemFirst(
      groups.map((group) => ({
        ...group,
        rows: sortStreamsProblemFirst(group.rows),
      })),
    )
  }, [filteredRows])

  const groupFilterOptions = useMemo(() => productGroupOptions(displayRows), [displayRows])

  const operationsSummary = useMemo(() => computeStreamOperationsSummary(displayRows), [displayRows])

  const problemStreamItems = useMemo(() => buildProblemStreamItems(filteredRows), [filteredRows])

  const filtersActive = searchQuery.trim().length > 0 || quickFilter !== 'all' || groupFilter !== 'all'

  useEffect(() => {
    const label = new URLSearchParams(location.search).get('expand_group')?.trim()
    if (!label) return
    setExpandedProductGroups((prev) => {
      if (prev.has(label)) return prev
      const next = new Set(prev)
      next.add(label)
      return next
    })
  }, [location.search, productGroups.length])

  useEffect(() => {
    if (!highlightedGroupLabel || productGroups.length === 0) return
    const el = groupRowRefs.current.get(highlightedGroupLabel)
    if (el == null) return
    const timer = window.setTimeout(() => {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [highlightedGroupLabel, productGroups.length, expandedProductGroups])

  const streamsPageKpi = useMemo(
    () => computeStreamsPageKpi(productGroups, filteredRows.length),
    [productGroups, filteredRows.length],
  )

  const toggleProductGroup = useCallback((productLabel: string) => {
    setExpandedProductGroups((prev) => {
      const next = new Set(prev)
      if (next.has(productLabel)) next.delete(productLabel)
      else next.add(productLabel)
      return next
    })
  }, [])

  const streamsTableScrollRef = useRef<HTMLDivElement>(null)
  const [streamsTableScrollTop, setStreamsTableScrollTop] = useState(0)
  const [streamsTableViewportHeight, setStreamsTableViewportHeight] = useState(STREAMS_CONSOLE_VIRTUAL_VIEWPORT)
  const virtualizeStreamsTable = filteredRows.length >= STREAMS_CONSOLE_VIRTUALIZE_MIN

  const streamsTableVirtualRange = useMemo(() => {
    if (!virtualizeStreamsTable) {
      return {
        startIndex: 0,
        endIndex: Math.max(filteredRows.length - 1, -1),
        offsetTop: 0,
        totalSize: 0,
      }
    }
    return computeFixedRowVirtualRange(
      filteredRows.length,
      STREAMS_CONSOLE_ROW_HEIGHT,
      streamsTableScrollTop,
      streamsTableViewportHeight,
    )
  }, [virtualizeStreamsTable, filteredRows.length, streamsTableScrollTop, streamsTableViewportHeight])

  const visibleStreamRows = useMemo(() => {
    if (!virtualizeStreamsTable) return filteredRows
    const { startIndex, endIndex } = streamsTableVirtualRange
    if (endIndex < startIndex) return []
    return filteredRows.slice(startIndex, endIndex + 1)
  }, [virtualizeStreamsTable, filteredRows, streamsTableVirtualRange])

  const streamsTablePaddingBottom = useMemo(() => {
    if (!virtualizeStreamsTable) return 0
    const { endIndex, totalSize, offsetTop, startIndex } = streamsTableVirtualRange
    const rendered = Math.max(0, endIndex - startIndex + 1) * STREAMS_CONSOLE_ROW_HEIGHT
    return Math.max(0, totalSize - offsetTop - rendered)
  }, [virtualizeStreamsTable, streamsTableVirtualRange])

  const onStreamsTableScroll = useCallback(() => {
    const el = streamsTableScrollRef.current
    if (el == null) return
    setStreamsTableScrollTop(el.scrollTop)
    setStreamsTableViewportHeight(el.clientHeight)
  }, [])

  const streamsEmptyMessage = useMemo(() => {
    if (streamsAuthRequired) return GDC_AUTH_REQUIRED_MESSAGE
    if (streamsListError) return streamsListError
    if (streamsLoading) return ''
    if (displayRows.length > 0 && filteredRows.length === 0) {
      return filtersActive
        ? 'No streams match your filters.'
        : 'No stream groups found.'
    }
    if (isDevValidationLabUiEnabled()) {
      return 'No streams returned from the API. For validation-lab streams, enable ENABLE_DEV_VALIDATION_LAB on a non-production APP_ENV and the dev-validation fixture stack (see docs/testing/dev-validation-lab.md). Otherwise run scripts/seed.py or create a stream from the wizard.'
    }
    return 'No streams configured yet. Create your first stream from the wizard to connect a source, map fields, and deliver to a destination.'
  }, [
    streamsAuthRequired,
    streamsListError,
    streamsLoading,
    displayRows.length,
    filteredRows.length,
    filtersActive,
  ])

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Streams</h2>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-gdc-muted">Monitor and manage your data streams.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            to={newStreamPath()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Stream
          </Link>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gdc-elevated dark:hover:text-slate-200"
              aria-label="List view"
              title="List view"
            >
              <LayoutList className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gdc-elevated dark:hover:text-slate-200"
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setRefreshVersion((v) => v + 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gdc-elevated dark:hover:text-slate-200"
              aria-label="Refresh streams"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gdc-elevated dark:hover:text-slate-200"
              aria-label="Stream settings"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
            </button>
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

      <StreamsGroupKpiStrip kpi={streamsPageKpi} loading={streamsLoading && displayRows.length === 0} />

      <StreamsOperationsSummaryStrip summary={operationsSummary} loading={streamsLoading && displayRows.length === 0} />

      <StreamsOperationsToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        quickFilter={quickFilter}
        onQuickFilterChange={setQuickFilter}
        groupFilter={groupFilter}
        onGroupFilterChange={setGroupFilter}
        groupOptions={groupFilterOptions}
      />

      <StreamsProblemPanel items={problemStreamItems} />

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card" data-testid="streams-product-groups">
        {streamsLoading && displayRows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-slate-500 dark:text-gdc-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading streams…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p
              className={cn('text-[13px]', streamsAuthRequired && 'font-medium text-amber-800 dark:text-amber-200')}
              data-testid={streamsAuthRequired ? 'streams-auth-required' : 'streams-empty-state'}
            >
              {streamsEmptyMessage}
            </p>
            {!streamsAuthRequired && displayRows.length === 0 ? (
              <Link
                to="/streams/new"
                data-testid="streams-create-first"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create First Stream
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={opTable}>
                <thead>
                  <tr className={opThRow}>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[12rem]')}>
                      Group Name
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[6rem]')}>
                      Status
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[6rem]')}>
                      Streams
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[9rem]')}>
                      Ingest Rate
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[9rem]')}>
                      Delivery Rate
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[7rem]')}>
                      Success Rate
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[8rem]')}>
                      Issues
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'min-w-[6rem]')}>
                      Last Event
                    </th>
                    <th scope="col" className={cn(streamsGroupTableThClass, 'w-10 pr-3 text-right')}>
                      <span className="sr-only">Expand</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {productGroups.map((group) => {
                    const expanded = expandedProductGroups.has(group.productLabel)
                    const groupMetrics = aggregateGroupRates(group.rows)
                    const sparklines = aggregateGroupSparklines(group.rows)
                    const issues = aggregateGroupIssueBreakdown(group.rows)
                    const healthLabel = groupHealthLabel(group.worstStatus)
                    const healthTone = groupHealthTone(group.worstStatus)
                    const successTone = successRateTone(groupMetrics.successPct)
                    const subtitle = group.rows[0]?.connectorName ?? ''
                    return (
                      <Fragment key={group.productLabel}>
                        <tr
                          ref={(el) => {
                            if (el) groupRowRefs.current.set(group.productLabel, el)
                            else groupRowRefs.current.delete(group.productLabel)
                          }}
                          data-testid={`stream-group-row-${group.productLabel}`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          onClick={() => toggleProductGroup(group.productLabel)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleProductGroup(group.productLabel)
                            }
                          }}
                          className={cn(
                            opTr,
                            'cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-gdc-rowHover/50',
                            expanded && 'bg-slate-50/50 dark:bg-gdc-elevated/20',
                            highlightedGroupLabel === group.productLabel &&
                              'ring-2 ring-inset ring-violet-500/50 bg-violet-500/10 dark:bg-violet-500/15',
                          )}
                        >
                          <td className={streamsGroupTableTdClass}>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{group.productLabel}</p>
                              {subtitle ? (
                                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-gdc-muted">{subtitle}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className={streamsGroupTableTdClass}>
                            <GroupHealthBadge label={healthLabel} tone={healthTone} />
                          </td>
                          <td className={cn(streamsGroupTableTdClass, 'tabular-nums font-medium text-slate-800 dark:text-slate-100')}>
                            {group.rows.length} Stream{group.rows.length === 1 ? '' : 's'}
                          </td>
                          <td className={streamsGroupTableTdClass}>
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap tabular-nums text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                {groupMetrics.ingestLabel}
                              </span>
                              <span className="text-sky-500 dark:text-sky-400">
                                <MiniSparkline values={sparklines.ingest} />
                              </span>
                            </div>
                          </td>
                          <td className={streamsGroupTableTdClass}>
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap tabular-nums text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                {groupMetrics.deliveryLabel}
                              </span>
                              <span className="text-violet-500 dark:text-violet-400">
                                <MiniSparkline values={sparklines.delivery} />
                              </span>
                            </div>
                          </td>
                          <td className={streamsGroupTableTdClass}>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'whitespace-nowrap tabular-nums text-[12px] font-semibold',
                                  successTone === 'critical' && 'text-red-600 dark:text-red-400',
                                  successTone === 'warning' && 'text-amber-600 dark:text-amber-400',
                                  successTone === 'healthy' && 'text-emerald-600 dark:text-emerald-400',
                                )}
                              >
                                {groupMetrics.successLabel}
                              </span>
                              <span
                                className={cn(
                                  successTone === 'critical' && 'text-red-500',
                                  successTone === 'warning' && 'text-amber-500',
                                  successTone === 'healthy' && 'text-emerald-500',
                                )}
                              >
                                <MiniSparkline values={sparklines.success} />
                              </span>
                            </div>
                          </td>
                          <td className={cn(streamsGroupTableTdClass, 'text-[11px] font-semibold tabular-nums')}>
                            <span
                              className={cn(
                                issues.total > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gdc-muted',
                              )}
                            >
                              {issues.label}
                            </span>
                          </td>
                          <td className={cn(streamsGroupTableTdClass, 'whitespace-nowrap tabular-nums text-[12px] text-slate-500 dark:text-gdc-muted')}>
                            {groupLastEventLabel(group.rows)}
                          </td>
                          <td className={cn(streamsGroupTableTdClass, 'pr-3 text-right')}>
                            {expanded ? (
                              <ChevronDown className="inline h-4 w-4 text-slate-400" aria-hidden />
                            ) : (
                              <ChevronRight className="inline h-4 w-4 text-slate-400" aria-hidden />
                            )}
                          </td>
                        </tr>
                        {expanded
                          ? group.rows.map((row) => {
                              const issueSummaries = deriveConsoleRowIssueSummaries(row)
                              const severity = effectiveStreamSeverity(row)
                              return (
                                <tr
                                  key={row.id}
                                  data-testid={`stream-group-child-row-${row.id}`}
                                  className={cn(
                                    opTr,
                                    streamRowHighlightClass(row),
                                    'cursor-pointer transition-colors hover:bg-slate-100/80 dark:hover:bg-gdc-rowHover/60',
                                  )}
                                  onClick={() => navigate(streamRuntimePath(row.id))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      navigate(streamRuntimePath(row.id))
                                    }
                                  }}
                                  role="link"
                                  tabIndex={0}
                                >
                                  <td className={cn(streamsGroupTableTdClass, 'pl-8')}>
                                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                                      <StreamSeverityIcon row={row} />
                                      <span className="truncate">{row.name}</span>
                                    </span>
                                  </td>
                                  <td className={streamsGroupTableTdClass}>
                                    <StreamStatusBadge status={row.status} />
                                  </td>
                                  <td className={streamsGroupTableTdClass} aria-hidden="true" />
                                  <td className={cn(streamsGroupTableTdClass, 'whitespace-nowrap tabular-nums text-[12px] font-medium')}>
                                    {ingestRateLabel(row)}
                                  </td>
                                  <td className={cn(streamsGroupTableTdClass, 'whitespace-nowrap tabular-nums text-[12px] font-medium')}>
                                    {deliveryRateLabel(row)}
                                  </td>
                                  <td
                                    className={cn(
                                      streamsGroupTableTdClass,
                                      'whitespace-nowrap tabular-nums text-[12px] font-medium',
                                      severity === 'warning' || severity === 'critical'
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : '',
                                    )}
                                  >
                                    {formatSuccessRate(row.deliveryPct, row.deliveryPctKnown)}
                                  </td>
                                  <td
                                    className={cn(
                                      streamsGroupTableTdClass,
                                      'whitespace-nowrap text-[11px] font-semibold tabular-nums',
                                      issueSummaries.length > 0
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : 'text-slate-500 dark:text-gdc-muted',
                                    )}
                                  >
                                    {issueSummaries.length > 0 ? issueSummaries.length : '0'}
                                  </td>
                                  <td className={cn(streamsGroupTableTdClass, 'whitespace-nowrap tabular-nums text-[12px] text-slate-500 dark:text-gdc-muted')}>
                                    {row.hasRuntimeApiSnapshot ? row.lastActivityRelative : '—'}
                                  </td>
                                  <td className={streamsGroupTableTdClass} aria-hidden="true" />
                                </tr>
                              )
                            })
                          : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
              Showing 1 to {productGroups.length} of {productGroups.length} stream groups
            </div>
          </>
        )}
      </div>

      {/* Legacy flat table (hidden — kept for virtualized regression tests) */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div
          ref={streamsTableScrollRef}
          data-testid={virtualizeStreamsTable ? 'streams-console-virtual-scroll' : undefined}
          className={cn('overflow-x-auto', virtualizeStreamsTable && 'max-h-[min(70vh,560px)] overflow-y-auto')}
          onScroll={virtualizeStreamsTable ? onStreamsTableScroll : undefined}
        >
          <table className={opTable}>
            <thead>
              <tr className={opThRow}>
                <th scope="col" className={cn(opTh, 'min-w-[140px]')}>
                  Stream
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[160px]')}>
                  Source connection / Source
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[96px]')}>
                  Status
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[150px]')}>
                  <span title="Source input events from run_complete.">Processed events (window)</span>
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[130px]')}>
                  Last sync position
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Delivery paths
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
                    {streamsLoading && displayRows.length === 0 ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Loading streams…
                      </span>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <span
                          className={cn(
                            streamsAuthRequired && 'font-medium text-amber-800 dark:text-amber-200',
                          )}
                        >
                          {streamsEmptyMessage}
                        </span>
                        {!streamsAuthRequired && displayRows.length === 0 && filteredRows.length === 0 ? (
                          <Link
                            to="/streams/new"
                            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                            Create First Stream
                          </Link>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ) : null}
              {virtualizeStreamsTable && streamsTableVirtualRange.offsetTop > 0 ? (
                <tr aria-hidden="true" style={{ height: streamsTableVirtualRange.offsetTop }}>
                  <td colSpan={10} className="p-0" />
                </tr>
              ) : null}
              {visibleStreamRows.map((row) => {
                const workflow = streamWorkflowFromRow(row, workflowExtrasByStreamId[row.id])
                const rowUi = resolveSourceTypePresentation(row.streamTypeKey)
                const runNowExtra = operationalRunControlTooltipSupplement(row.name)
                return (
                  <tr key={row.id} className={opTr}>
                    <td className={opTd}>
                      <button type="button" className="w-full text-left">
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
                      ) : !row.deliveryPctKnown ? (
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">No delivery outcomes</span>
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
                          aria-label={`Stream monitoring: ${row.name}`}
                          title="Monitoring"
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
                          disabled={!/^\d+$/.test(row.id) || runOnceStreamId !== null}
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
              {virtualizeStreamsTable && streamsTablePaddingBottom > 0 ? (
                <tr aria-hidden="true" style={{ height: streamsTablePaddingBottom }}>
                  <td colSpan={10} className="p-0" />
                </tr>
              ) : null}
            </tbody>
          </table>
          {virtualizeStreamsTable ? (
            <p className="sr-only" aria-live="polite">
              Showing {visibleStreamRows.length} of {filteredRows.length} streams in viewport
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular-nums">
            Showing {filteredRows.length} stream{filteredRows.length === 1 ? '' : 's'} (total {sectionKpi.total})
          </p>
        </div>
      </div>

      <p className="text-[11px] tabular-nums text-slate-500 dark:text-gdc-muted">
        {productGroups.length} Stream Group{productGroups.length === 1 ? '' : 's'} | {filteredRows.length} Stream{filteredRows.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}
