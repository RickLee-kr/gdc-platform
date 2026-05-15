import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  History,
  Loader2,
  Play,
  Square,
  Radio,
  XCircle,
  GitBranch,
  Send,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
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
import {
  buildStreamExportPath,
  downloadBackupUrl,
  postCloneStream,
} from '../../api/gdcBackup'
import { replayStreamBackfill, type BackfillJobDto } from '../../api/gdcBackfill'
import {
  fetchStreamCheckpointHistory,
  fetchStreamRuntimeHealth,
  fetchStreamRuntimeMetrics,
  fetchStreamRuntimeStats,
  fetchStreamRuntimeTimeline,
  runStreamOnce,
  saveRuntimeRouteEnabledState,
  startRuntimeStream,
  stopRuntimeStream,
} from '../../api/gdcRuntime'
import { fetchStreamById } from '../../api/gdcStreams'
import { buildRuntimeDetailNumericOverlay, mergeStreamHealthSignals } from '../../api/runtimeHealthAdapter'
import {
  breakdownSlicesFromMetrics,
  chartBucketsFromMetrics,
  eventsSparklineFromMetrics,
  runHistoryFromMetricsRecentRuns,
} from '../../api/runtimeMetricsAdapter'
import { timelineItemsToRecentLogLines, timelineItemsToRunHistoryRows } from '../../api/runtimeTimelineAdapter'
import { formatCheckpointValueForConsole, mapBackendStreamStatus } from '../../api/streamRows'
import { cn } from '../../lib/utils'
import { useSessionCapabilities } from '../../lib/rbac'
import { logsExplorerPath, logsPath, NAV_PATH, streamApiTestPath, streamEditPath, streamMappingPath } from '../../config/nav-paths'
import { computeStreamWorkflow } from '../../utils/streamWorkflow'
import { resolveSourceTypePresentation } from '../../utils/sourceTypePresentation'
import { formatRunOnceSummaryLines } from '../../utils/formatRunOnceSummary'
import { RecentRouteErrorsPanel, RouteOperationalPanel } from './route-operational-panel'
import { StreamRuntimeHealthExtension } from './stream-runtime-health-extension'
import { StreamWorkflowSummaryStrip } from './stream-workflow-checklist'
import { StatusBadge } from '../shell/status-badge'
import { RuntimeChartCard } from '../shell/runtime-chart-card'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import type { RecentLogLine, RunHistoryRow, RuntimeHistoryTab } from './stream-runtime-detail-model'
import { emptyStreamRuntimeDetail } from './stream-runtime-detail-model'
import type {
  CheckpointHistoryResponse,
  StreamHealthResponse,
  StreamRead,
  StreamRuntimeMetricsResponse,
  StreamRuntimeStatsResponse,
} from '../../api/types/gdcApi'
import type { StreamRuntimeStatus } from '../../api/streamRows'

const HISTORY_TABS: ReadonlyArray<{ key: RuntimeHistoryTab; label: string }> = [
  { key: 'runHistory', label: 'Run History' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'checkpoint', label: 'Checkpoint' },
  { key: 'routes', label: 'Routes' },
  { key: 'logs', label: 'Logs' },
  { key: 'errors', label: 'Errors' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'configuration', label: 'Configuration' },
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
      const _e: never = s
      return _e
    }
  }
}

function MiniSparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const w = 44
  const h = 14
  const padX = 1
  const padY = 1
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cn('shrink-0 text-violet-600 dark:text-violet-400', className)} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" points={pts.join(' ')} />
    </svg>
  )
}

function DeliveryBar({ pct, thin }: { pct: number; thin?: boolean }) {
  const tone =
    pct >= 99 ? 'bg-emerald-500' : pct >= 85 ? 'bg-amber-500' : pct <= 0 ? 'bg-slate-300 dark:bg-slate-600' : 'bg-red-500'
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated', thin ? 'h-1' : 'h-1.5')}>
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function KpiCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-[6.25rem] flex-col rounded-lg border border-slate-200/70 bg-white/90 p-3 shadow-none dark:border-gdc-border/90 dark:bg-gdc-card',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function StreamRuntimeDetailPage() {
  const { streamId = '' } = useParams<{ streamId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const data = useMemo(() => emptyStreamRuntimeDetail(streamId), [streamId])
  const [historyTab, setHistoryTab] = useState<RuntimeHistoryTab>('runHistory')
  const [timelineRunHistory, setTimelineRunHistory] = useState<RunHistoryRow[] | null>(null)
  const [timelineRecentLogs, setTimelineRecentLogs] = useState<RecentLogLine[] | null>(null)
  const [timelineRunIdHint, setTimelineRunIdHint] = useState<string | null>(null)
  const [runtimeStats, setRuntimeStats] = useState<StreamRuntimeStatsResponse | null>(null)
  const [runtimeHealth, setRuntimeHealth] = useState<StreamHealthResponse | null>(null)
  const [controlBusy, setControlBusy] = useState(false)
  const [routeToggleBusyId, setRouteToggleBusyId] = useState<number | null>(null)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [runOnceBusy, setRunOnceBusy] = useState(false)
  const [runOnceLines, setRunOnceLines] = useState<string[] | null>(null)
  const [runOnceError, setRunOnceError] = useState<string | null>(null)
  const [timelineLevelFilter, setTimelineLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>(searchParams.get('focus') === 'incident' ? 'ERROR' : 'ALL')
  const [streamEntity, setStreamEntity] = useState<StreamRead | null>(null)
  const [runtimeMetrics, setRuntimeMetrics] = useState<StreamRuntimeMetricsResponse | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [metricsRefreshAt, setMetricsRefreshAt] = useState<string | null>(null)
  const [checkpointHistory, setCheckpointHistory] = useState<CheckpointHistoryResponse | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [bfStart, setBfStart] = useState('')
  const [bfEnd, setBfEnd] = useState('')
  const [bfDryRun, setBfDryRun] = useState(false)
  const [bfBusy, setBfBusy] = useState(false)
  const [bfResult, setBfResult] = useState<BackfillJobDto | null>(null)
  const [bfLastWasDryRun, setBfLastWasDryRun] = useState<boolean | null>(null)
  const [bfError, setBfError] = useState<string | null>(null)

  const caps = useSessionCapabilities()
  const canRuntimeControl = caps.runtime_stream_control === true
  const canMutateWorkspace = caps.workspace_mutations === true
  const canBackfill = caps.backfill_mutations === true
  const canClone = caps.backup_clone === true

  const backendStreamId = useMemo(() => (/^\d+$/.test(streamId) ? Number(streamId) : undefined), [streamId])

  const logsExplorerDrilldown = useMemo(() => {
    if (backendStreamId == null) return null
    return logsExplorerPath({
      stream_id: backendStreamId,
      run_id: timelineRunIdHint ?? undefined,
    })
  }, [backendStreamId, timelineRunIdHint])

  const logsWithFocusHref = useCallback(
    (focus: string) => {
      const base = logsExplorerDrilldown ?? logsPath(streamId)
      const sep = base.includes('?') ? '&' : '?'
      return `${base}${sep}focus=${encodeURIComponent(focus)}`
    },
    [logsExplorerDrilldown, streamId],
  )

  useEffect(() => {
    if (!backfillOpen || backendStreamId == null) return
    const end = new Date()
    const start = new Date(end.getTime() - 14 * 86400000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    setBfStart(fmt(start))
    setBfEnd(fmt(end))
    setBfResult(null)
    setBfError(null)
    setBfLastWasDryRun(null)
  }, [backfillOpen, backendStreamId])

  useEffect(() => {
    if (backendStreamId == null) {
      setStreamEntity(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const s = await fetchStreamById(backendStreamId)
      if (!cancelled) setStreamEntity(s)
    })()
    return () => {
      cancelled = true
    }
  }, [backendStreamId])

  const loadRuntimeMetrics = useCallback(async () => {
    if (backendStreamId == null) {
      setRuntimeMetrics(null)
      setMetricsError(null)
      return
    }
    setMetricsLoading(true)
    setMetricsError(null)
    const m = await fetchStreamRuntimeMetrics(backendStreamId)
    if (m) {
      setRuntimeMetrics(m)
      setMetricsRefreshAt(new Date().toISOString())
    } else {
      setMetricsError('Metrics API unavailable')
    }
    setMetricsLoading(false)
  }, [backendStreamId])

  const refreshRuntimeData = useCallback(async () => {
    if (backendStreamId == null) {
      setTimelineRunHistory(null)
      setTimelineRecentLogs(null)
      setTimelineRunIdHint(null)
      setRuntimeStats(null)
      setRuntimeHealth(null)
      setCheckpointHistory(null)
      return false
    }
    const [res, st, hlth, chk] = await Promise.all([
      fetchStreamRuntimeTimeline(backendStreamId, { limit: 80 }),
      fetchStreamRuntimeStats(backendStreamId, 120),
      fetchStreamRuntimeHealth(backendStreamId, 120),
      fetchStreamCheckpointHistory(backendStreamId, 14),
    ])
    setCheckpointHistory(chk)
    if (res?.items?.length) {
      const items = res.items
      const last = items[items.length - 1]
      const rid = typeof last.run_id === 'string' && last.run_id.trim() !== '' ? last.run_id : null
      setTimelineRunIdHint(rid)
      setTimelineRunHistory(timelineItemsToRunHistoryRows(items))
      setTimelineRecentLogs(timelineItemsToRecentLogLines(items, 14))
    } else {
      setTimelineRunHistory(null)
      setTimelineRecentLogs(null)
      setTimelineRunIdHint(null)
    }
    setRuntimeStats(st)
    setRuntimeHealth(hlth)
    void loadRuntimeMetrics()
    return true
  }, [backendStreamId, loadRuntimeMetrics])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await refreshRuntimeData()
      if (!cancelled && !ok) {
        setTimelineRunHistory(null)
        setTimelineRecentLogs(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshRuntimeData])

  useEffect(() => {
    if (backendStreamId == null) {
      setRuntimeMetrics(null)
      setMetricsError(null)
      setMetricsLoading(false)
      return
    }
    const t = window.setInterval(() => {
      void loadRuntimeMetrics()
    }, 30_000)
    return () => window.clearInterval(t)
  }, [backendStreamId, loadRuntimeMetrics])

  const runStreamControl = useCallback(
    async (action: 'start' | 'stop') => {
      if (!canRuntimeControl || backendStreamId == null || controlBusy || runOnceBusy) return
      setControlBusy(true)
      setControlMessage(null)
      const res = action === 'start' ? await startRuntimeStream(backendStreamId) : await stopRuntimeStream(backendStreamId)
      if (res) {
        await refreshRuntimeData()
        window.dispatchEvent(new CustomEvent('gdc-runtime-control-updated', { detail: { streamId: backendStreamId, action } }))
        setControlMessage(res.message)
      } else {
        setControlMessage('Runtime API unavailable · control action not applied.')
      }
      setControlBusy(false)
    },
    [backendStreamId, canRuntimeControl, controlBusy, refreshRuntimeData, runOnceBusy],
  )

  const executeRunOnce = useCallback(async () => {
    if (!canRuntimeControl || backendStreamId == null || runOnceBusy || controlBusy) return
    setRunOnceBusy(true)
    setRunOnceLines(null)
    setRunOnceError(null)
    setControlMessage(null)
    try {
      const r = await runStreamOnce(backendStreamId)
      setRunOnceLines(formatRunOnceSummaryLines(r))
      await refreshRuntimeData()
      window.dispatchEvent(new CustomEvent('gdc-runtime-run-once', { detail: { streamId: backendStreamId, response: r } }))
    } catch (e) {
      setRunOnceError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunOnceBusy(false)
    }
  }, [backendStreamId, canRuntimeControl, runOnceBusy, controlBusy, refreshRuntimeData])

  const executeBackfill = useCallback(async () => {
    if (!canBackfill || backendStreamId == null || bfBusy) return
    setBfBusy(true)
    setBfError(null)
    setBfResult(null)
    setBfLastWasDryRun(null)
    try {
      const job = await replayStreamBackfill({
        stream_id: backendStreamId,
        start_time: new Date(bfStart).toISOString(),
        end_time: new Date(bfEnd).toISOString(),
        dry_run: bfDryRun,
      })
      setBfResult(job)
      setBfLastWasDryRun(bfDryRun)
    } catch (e) {
      setBfError(e instanceof Error ? e.message : String(e))
    } finally {
      setBfBusy(false)
    }
  }, [backendStreamId, bfBusy, bfDryRun, bfEnd, bfStart, canBackfill])

  const onExportStreamBackup = useCallback(async () => {
    if (backendStreamId == null) return
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      const url = buildStreamExportPath(backendStreamId, { include_destinations: true })
      await downloadBackupUrl(url, `stream-${backendStreamId}-export.json`)
      setBackupMsg('Export downloaded.')
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }, [backendStreamId])

  const onCloneStreamBackup = useCallback(async () => {
    if (!canClone || backendStreamId == null) return
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      const r = await postCloneStream(backendStreamId)
      navigate(r.redirect_path)
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }, [backendStreamId, canClone, navigate])

  const onToggleRouteEnabled = useCallback(
    async (routeId: number, nextEnabled: boolean, opts?: { disable_reason?: string | null }) => {
      if (!canRuntimeControl || routeToggleBusyId != null) return
      setRouteToggleBusyId(routeId)
      setControlMessage(null)
      const res = await saveRuntimeRouteEnabledState(
        routeId,
        nextEnabled,
        !nextEnabled ? { disable_reason: opts?.disable_reason ?? undefined } : undefined,
      )
      if (res) {
        await refreshRuntimeData()
        window.dispatchEvent(
          new CustomEvent('gdc-runtime-control-updated', {
            detail: { streamId: backendStreamId, routeId, routeEnabled: nextEnabled },
          }),
        )
        setControlMessage(res.message)
      } else {
        setControlMessage('Runtime API unavailable · route state unchanged.')
      }
      setRouteToggleBusyId(null)
    },
    [backendStreamId, canRuntimeControl, refreshRuntimeData, routeToggleBusyId],
  )

  const recentLogLines = timelineRecentLogs ?? []
  const filteredRecentLogLines = useMemo(
    () => recentLogLines.filter((log) => timelineLevelFilter === 'ALL' || log.level === timelineLevelFilter),
    [recentLogLines, timelineLevelFilter],
  )

  const displayStatus: StreamRuntimeStatus = useMemo(() => {
    if (runtimeMetrics?.stream?.status) return mapBackendStreamStatus(runtimeMetrics.stream.status)
    if (runtimeStats) return mapBackendStreamStatus(runtimeStats.stream_status)
    if (runtimeHealth) return mapBackendStreamStatus(runtimeHealth.stream_status)
    return 'UNKNOWN'
  }, [runtimeMetrics, runtimeStats, runtimeHealth])

  const numericOverlay = useMemo(
    () => buildRuntimeDetailNumericOverlay(runtimeStats, runtimeHealth, runtimeMetrics),
    [runtimeStats, runtimeHealth, runtimeMetrics],
  )

  const events1h = numericOverlay.events1h
  const eventsPerMinApprox = numericOverlay.eventsPerMinApprox
  const eventsSparkline = useMemo(() => {
    if (runtimeMetrics) return [...eventsSparklineFromMetrics(runtimeMetrics)]
    if (numericOverlay.events1h == null) return [0, 0, 0, 0, 0, 0, 0]
    const v = numericOverlay.events1h
    return [v, v, v, v, v, v, v]
  }, [runtimeMetrics, numericOverlay.events1h])

  const deliveryPct = numericOverlay.deliveryPct
  const deliveryLabel = numericOverlay.deliveryLabel

  const routesTotal = numericOverlay.routesTotal
  const routesOk = numericOverlay.routesOk
  const routesWarn = numericOverlay.routesWarn
  const routesErr = numericOverlay.routesErr

  const streamHealthSignals = useMemo(
    () => mergeStreamHealthSignals(data.streamHealthSignals, runtimeStats, runtimeHealth, runtimeMetrics),
    [data.streamHealthSignals, runtimeStats, runtimeHealth, runtimeMetrics],
  )

  const eventsOverChartData = useMemo(() => {
    const fromApi = chartBucketsFromMetrics(runtimeMetrics)
    if (fromApi.length > 0) return fromApi
    return [...data.eventsOverTime]
  }, [runtimeMetrics, data.eventsOverTime])

  const eventsBreakdownData = useMemo(() => {
    const fromApi = breakdownSlicesFromMetrics(runtimeMetrics)
    if (fromApi.length > 0) return fromApi
    return [...data.eventsBreakdown]
  }, [runtimeMetrics, data.eventsBreakdown])

  const runHistoryRows = useMemo(() => {
    const fromMetrics = runHistoryFromMetricsRecentRuns(runtimeMetrics)
    if (fromMetrics.length > 0) return fromMetrics
    return timelineRunHistory ?? []
  }, [runtimeMetrics, timelineRunHistory])

  const hasRuntimeObsApi = runtimeStats != null || runtimeHealth != null || runtimeMetrics != null

  const runtimeWorkflow = useMemo(
    () =>
      computeStreamWorkflow({
        streamId,
        status: displayStatus,
        events1h: events1h ?? 0,
        deliveryPct: deliveryPct ?? 0,
        routesTotal: routesTotal ?? 0,
        routesOk: routesOk ?? 0,
        routesError: routesErr ?? 0,
        hasConnector: true,
        sourceType: streamEntity?.stream_type ?? null,
      }),
    [streamId, displayStatus, events1h, deliveryPct, routesTotal, routesOk, routesErr, streamEntity?.stream_type],
  )

  const donutTotal = useMemo(() => eventsBreakdownData.reduce((s, x) => s + x.value, 0), [eventsBreakdownData])

  const routeRetryTotalLastHour = useMemo(() => {
    const rr = runtimeMetrics?.route_runtime
    if (!rr?.length) return null
    const n = rr.reduce((acc, r) => acc + (Number.isFinite(r.retry_count_last_hour) ? r.retry_count_last_hour : 0), 0)
    return n
  }, [runtimeMetrics?.route_runtime])

  const metricsChartsEmpty = useMemo(() => {
    if (!runtimeMetrics) return false
    const sum = eventsOverChartData.reduce((s, b) => s + b.ingested + b.delivered + b.failed, 0)
    return sum === 0
  }, [runtimeMetrics, eventsOverChartData])
  const latestIncident = useMemo(
    () => filteredRecentLogLines.find((log) => log.level === 'ERROR') ?? filteredRecentLogLines.find((log) => log.level === 'WARN') ?? null,
    [filteredRecentLogLines],
  )

  const runtimeSourceUi = useMemo(
    () => resolveSourceTypePresentation(streamEntity?.stream_type),
    [streamEntity?.stream_type],
  )
  const SourceKindIcon = runtimeSourceUi.icon

  function incidentHints(): { label: string; to: string }[] {
    const retry = { label: runtimeSourceUi.runtime.incidentRetryLabel, to: streamApiTestPath(streamId) }
    const delivery = `${streamEditPath(streamId)}?section=delivery`
    if (displayStatus === 'STOPPED') {
      return [
        { label: 'Enable Route', to: delivery },
        retry,
        { label: 'Open Logs', to: logsWithFocusHref('error') },
      ]
    }
    if (displayStatus === 'ERROR') {
      return [
        retry,
        { label: 'Review Mapping', to: streamMappingPath(streamId) },
        { label: 'Check Route', to: delivery },
        { label: 'Open Logs', to: logsWithFocusHref('error') },
      ]
    }
    if (displayStatus === 'DEGRADED') {
      return [
        { label: 'Check Route', to: delivery },
        { label: 'Enable Route', to: delivery },
        { label: 'Open Logs', to: logsWithFocusHref('error') },
      ]
    }
    if (streamHealthSignals.some((s) => String(s.label).toLowerCase().includes('rate'))) {
      return [
        { label: 'Open Logs', to: logsWithFocusHref('error') },
        { label: 'Check Route', to: delivery },
      ]
    }
    return [
      { label: 'Open Logs', to: logsWithFocusHref('error') },
      { label: 'Open Runtime', to: NAV_PATH.runtime },
    ]
  }

  function stageIcon(stage: string) {
    const s = stage.toLowerCase()
    if (s.includes('source')) return Database
    if (s.includes('mapping') || s.includes('enrichment')) return Cpu
    if (s.includes('route')) return GitBranch
    if (s.includes('send') || s.includes('delivery')) return Send
    return Radio
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      {!canRuntimeControl ? (
        <p
          role="status"
          className="rounded-lg border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100/95"
        >
          Read-only monitoring session: stream start/stop, Run Now, route toggles, and backfill controls are hidden. Metrics, charts, and log
          links remain available.
        </p>
      ) : null}
      {/* Page header */}
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-3 dark:border-gdc-border sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {(streamEntity?.name ?? '').trim() || data.name}{' '}
              <span className="font-normal text-slate-500 dark:text-gdc-muted">({data.streamId})</span>
            </h2>
            <StatusBadge tone={statusTone(displayStatus)} className="font-bold uppercase tracking-wide">
              {displayStatus}
            </StatusBadge>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200">
              <SourceKindIcon className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
              {runtimeSourceUi.displayName}
            </span>
          </div>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
            {streamEntity?.connector_id != null ? `Connector #${streamEntity.connector_id}` : data.connectorName}{' '}
            <span className="text-slate-400">·</span>{' '}
            {streamEntity?.source_id != null ? `Source #${streamEntity.source_id}` : data.sourceTypeLabel}{' '}
            <span className="text-slate-400">·</span> Polling every{' '}
            {streamEntity?.polling_interval ?? data.pollingIntervalSec} sec
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            Last updated:{' '}
            {metricsRefreshAt
              ? `${metricsRefreshAt.slice(0, 19).replace('T', ' ')} · metrics`
              : data.lastUpdatedRelative}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canMutateWorkspace ? (
            <Link
              to={streamEditPath(streamId)}
              className="inline-flex h-8 items-center rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
            >
              Edit
            </Link>
          ) : (
            <span
              className="inline-flex h-8 cursor-not-allowed items-center rounded-md border border-slate-200/60 bg-slate-50 px-2.5 text-[12px] font-semibold text-slate-400 dark:border-gdc-border/60 dark:bg-gdc-section dark:text-slate-500"
              title="Viewer role cannot edit stream configuration."
            >
              Edit
            </span>
          )}
          <span className="inline-flex h-8 items-center rounded-md border border-violet-300/80 bg-violet-500/[0.12] px-2.5 text-[12px] font-semibold text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100">
            Runtime
          </span>
          {backendStreamId != null && canRuntimeControl ? (
            <>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy}
                onClick={() => void runStreamControl('start')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200/90 bg-emerald-500/[0.08] px-2.5 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                Start Stream
              </button>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy}
                onClick={() => void runStreamControl('stop')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200/90 bg-red-500/[0.07] px-2.5 text-[12px] font-semibold text-red-800 hover:bg-red-500/[0.12] disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
                Stop Stream
              </button>
            </>
          ) : null}
          {canRuntimeControl ? (
            <button
              type="button"
              disabled={backendStreamId == null || runOnceBusy || controlBusy}
              onClick={() => void executeRunOnce()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runOnceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              {runOnceBusy ? 'Running…' : 'Run Now'}
            </button>
          ) : null}
          {canBackfill ? (
            <button
              type="button"
              data-testid="stream-run-backfill-open"
              disabled={backendStreamId == null || bfBusy || runOnceBusy || controlBusy}
              onClick={() => setBackfillOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-500/[0.08] px-2.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20"
            >
              <History className="h-3.5 w-3.5" aria-hidden />
              Run Backfill
            </button>
          ) : null}
          <button
            type="button"
            disabled={backendStreamId == null || metricsLoading}
            onClick={() => void loadRuntimeMetrics()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
          >
            {metricsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Refresh metrics
          </button>
          {backendStreamId != null ? (
            <>
              <button
                type="button"
                disabled={backupBusy || runOnceBusy || controlBusy}
                onClick={() => void onExportStreamBackup()}
                className="inline-flex h-8 items-center rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
              >
                {backupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Export JSON
              </button>
              <button
                type="button"
                disabled={backupBusy || runOnceBusy || controlBusy || !canClone}
                onClick={() => void onCloneStreamBackup()}
                className="inline-flex h-8 items-center rounded-md border border-violet-200/90 bg-violet-500/[0.08] px-2.5 text-[12px] font-semibold text-violet-900 hover:bg-violet-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/20"
              >
                Clone stream
              </button>
            </>
          ) : null}
        </div>
      </div>
      {controlMessage ? <p className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">{controlMessage}</p> : null}
      {backupMsg ? (
        <p
          className={cn(
            'text-[11px] font-medium',
            backupMsg.startsWith('Export downloaded') ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300',
          )}
          role={backupMsg.startsWith('Export downloaded') ? undefined : 'alert'}
        >
          {backupMsg}
        </p>
      ) : null}
      {runOnceError ? (
        <p className="text-[11px] font-medium text-red-700 dark:text-red-300" role="alert">
          {runOnceError}
        </p>
      ) : null}
      {metricsError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/70 bg-amber-500/[0.08] px-3 py-2 text-[12px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <span>{metricsError}</span>
          <button
            type="button"
            className="rounded-md border border-amber-400/80 bg-white px-2 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-50 dark:border-amber-500/50 dark:bg-gdc-card dark:text-amber-100 dark:hover:bg-gdc-rowHover"
            onClick={() => void loadRuntimeMetrics()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {runOnceLines?.length ? (
        <div
          role="status"
          className="rounded-md border border-emerald-300/70 bg-emerald-500/[0.06] px-2 py-1.5 text-[11px] text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
        >
          <p className="font-semibold">Latest run once</p>
          <ul className="mt-0.5 list-inside list-disc space-y-0.5">
            {runOnceLines.map((line, i) => (
              <li key={`run-once-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(displayStatus === 'ERROR' || displayStatus === 'DEGRADED' || displayStatus === 'STOPPED') ? (
        <section className="rounded-xl border border-amber-300/60 bg-amber-500/[0.08] p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Runtime incident state: {displayStatus}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {incidentHints().map((hint) => (
                <Link
                  key={hint.label}
                  to={hint.to}
                  className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                >
                  {hint.label}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <StreamWorkflowSummaryStrip
        snapshot={runtimeWorkflow}
        highlightCompleted={['connector', 'apiTest', 'mapping', 'enrichment']}
      />

      <StreamRuntimeHealthExtension backendStreamId={backendStreamId} />

      {/* KPI row */}
      <section aria-label="Stream runtime KPIs" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Status</p>
          <div className="mt-1">
            <StatusBadge tone={statusTone(displayStatus)} className="font-bold uppercase">
              {displayStatus}
            </StatusBadge>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-600 dark:text-gdc-muted">
            {hasRuntimeObsApi ? (
              <>Backend status: {String(runtimeStats?.stream_status ?? runtimeHealth?.stream_status ?? '—')}</>
            ) : (
              'No runtime summary yet'
            )}
          </p>
        </KpiCard>
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Events (1h)</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {events1h != null ? events1h.toLocaleString() : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            ~ {eventsPerMinApprox != null ? `${eventsPerMinApprox} / min` : '—'}
          </p>
          <div className="mt-1 text-emerald-600 dark:text-emerald-400">
            <MiniSparkline values={eventsSparkline} />
          </div>
        </KpiCard>
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Delivery</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {deliveryPct != null ? `${deliveryPct.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">{deliveryLabel ?? '—'}</p>
          <div className="mt-1.5">
            <DeliveryBar pct={deliveryPct ?? 0} />
          </div>
        </KpiCard>
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Latency (avg / max)</p>
          {metricsLoading && !runtimeMetrics ? (
            <div className="mt-2 h-8 animate-pulse rounded bg-slate-200/80 dark:bg-gdc-elevated" aria-hidden />
          ) : (
            <>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {runtimeMetrics ? `${Math.round(runtimeMetrics.kpis.avg_latency_ms)} ms` : '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
                max {runtimeMetrics ? `${Math.round(runtimeMetrics.kpis.max_latency_ms)} ms` : '—'} · 1h window
              </p>
            </>
          )}
        </KpiCard>
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Last Checkpoint</p>
          {runtimeMetrics?.stream.last_checkpoint || runtimeStats?.checkpoint ? (
            <>
              <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {String(runtimeMetrics?.stream.last_checkpoint?.type ?? runtimeStats?.checkpoint?.type ?? '')}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-700 dark:text-gdc-mutedStrong">
                {(() => {
                  const v = (runtimeMetrics?.stream.last_checkpoint?.value ?? runtimeStats?.checkpoint?.value) ?? {}
                  return formatCheckpointValueForConsole(v as Record<string, unknown>)
                })()}
              </p>
            </>
          ) : metricsLoading ? (
            <div className="mt-2 h-10 animate-pulse rounded bg-slate-200/80 dark:bg-gdc-elevated" aria-hidden />
          ) : (
            <p className="mt-2 text-[12px] text-slate-600 dark:text-gdc-muted">No checkpoint persisted yet</p>
          )}
        </KpiCard>
        <KpiCard>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Routes</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {routesTotal != null ? routesTotal : '—'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">
            {routesOk ?? '—'} OK <span className="text-slate-400">·</span> {routesWarn ?? '—'} WARN{' '}
            <span className="text-slate-400">·</span> {routesErr ?? '—'} ERR
          </p>
        </KpiCard>
      </section>

      {routeRetryTotalLastHour != null && routeRetryTotalLastHour > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/80 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-950 dark:border-amber-800/45 dark:bg-amber-950/25 dark:text-amber-100"
        >
          <p>
            <span className="font-semibold">Route retries (sum, last hour):</span>{' '}
            <span className="tabular-nums font-medium">{routeRetryTotalLastHour}</span>
            <span className="text-amber-800/90 dark:text-amber-200/85"> · from route_runtime aggregates</span>
          </p>
          {backendStreamId != null ? (
            <Link
              to={logsExplorerPath({ stream_id: backendStreamId, status: 'retry' })}
              className="shrink-0 font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              Open retry logs
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Checkpoint trace" className="mt-1">
        <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/30 dark:border-gdc-border dark:bg-gdc-card dark:ring-slate-800/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Checkpoint trace</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-gdc-muted">
                Recent committed <span className="font-mono text-[10px]">checkpoint_update</span> rows — correlate with{' '}
                <span className="font-mono text-[10px]">run_id</span> in Logs.
              </p>
              {checkpointHistory?.items?.length ? (
                <ul className="mt-2 space-y-2 text-[11px]">
                  {checkpointHistory.items.slice(0, 3).map((it) => (
                    <li
                      key={it.log_id}
                      className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-slate-100 bg-slate-50/50 px-2 py-1.5 dark:border-gdc-divider dark:bg-gdc-elevated/60"
                    >
                      <span className="shrink-0 font-mono text-[10px] text-slate-500 dark:text-gdc-muted">
                        {it.created_at.slice(0, 19).replace('T', ' ')}
                      </span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[10px] dark:border-gdc-border dark:bg-gdc-elevated">
                        {it.update_reason ?? '—'}
                      </span>
                      {it.partial_success ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-900 dark:text-amber-200">
                          Partial success
                        </span>
                      ) : null}
                      {it.run_id ? (
                        <Link
                          to={logsExplorerPath({ stream_id: backendStreamId ?? undefined, run_id: it.run_id })}
                          className="font-mono text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          Logs
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] text-slate-600 dark:text-gdc-muted">No checkpoint_update rows in recent history window.</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Link
                to={logsExplorerPath({ stream_id: backendStreamId ?? undefined, stage: 'checkpoint_update' })}
                className="inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-100/80 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-100"
              >
                Open checkpoint logs
              </Link>
              <Link
                to={logsExplorerPath({ stream_id: backendStreamId ?? undefined, partial_success: true })}
                className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                Partial-success runs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Observability row */}
      <section aria-label="Stream observability" className="grid gap-3 lg:grid-cols-12">
        <RuntimeChartCard
          title="Events over time"
          subtitle={runtimeMetrics ? 'Last 24h · hourly · metrics API' : 'Baseline preview'}
          className="lg:col-span-5"
        >
          <div className="flex h-[200px] w-full min-w-0 items-center justify-center px-3">
            {metricsLoading && !runtimeMetrics ? (
              <div className="h-[160px] w-full animate-pulse rounded-md bg-slate-200/70 dark:bg-gdc-elevated" aria-hidden />
            ) : metricsChartsEmpty ? (
              <p className="text-center text-[12px] text-slate-600 dark:text-gdc-muted">No throughput in this window (idle or no_events runs).</p>
            ) : eventsOverChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...eventsOverChartData]} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/80 dark:stroke-gdc-divider" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip
                    contentStyle={{ borderRadius: 6, border: '1px solid rgb(226 232 240)', fontSize: 11 }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Bar dataKey="ingested" name="Events" stackId="s" fill="#7c3aed" maxBarSize={18} />
                  <Bar dataKey="delivered" name="Delivered" stackId="s" fill="#22c55e" maxBarSize={18} />
                  <Bar dataKey="failed" name="Failed" stackId="s" fill="#ef4444" maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-[12px] text-slate-600 dark:text-gdc-muted">No chart data.</p>
            )}
          </div>
        </RuntimeChartCard>

        <RuntimeChartCard
          title="Events breakdown (1h)"
          subtitle={runtimeMetrics ? 'Delivered / failed / other · KPI window' : 'Baseline preview'}
          className="lg:col-span-4"
        >
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 px-3 sm:flex-row sm:items-center">
            {metricsLoading && !runtimeMetrics ? (
              <div className="h-[168px] w-[168px] shrink-0 animate-pulse rounded-full bg-slate-200/70 dark:bg-gdc-elevated" aria-hidden />
            ) : donutTotal > 0 ? (
              <>
                <div className="relative mx-auto h-[168px] w-[168px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[...eventsBreakdownData]}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={68}
                        paddingAngle={1.2}
                        stroke="none"
                      >
                        {eventsBreakdownData.map((entry) => (
                          <Cell key={entry.key} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid rgb(226 232 240)', fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{donutTotal.toLocaleString()}</p>
                    <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">events</p>
                  </div>
                </div>
                <ul className="flex min-w-0 flex-1 flex-col justify-center gap-1 text-[11px]" aria-label="Breakdown legend">
                  {eventsBreakdownData.map((s) => {
                    const pct = donutTotal ? ((s.value / donutTotal) * 100).toFixed(1) : '0'
                    return (
                      <li key={s.key} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1 dark:border-gdc-divider dark:bg-gdc-elevated">
                        <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-gdc-muted">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                          <span className="truncate font-medium">{s.label}</span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                          {s.value.toLocaleString()}{' '}
                          <span className="font-normal text-slate-500 dark:text-gdc-muted">({pct}%)</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="text-center text-[12px] text-slate-600 dark:text-gdc-muted">
                No volume in the last hour — idle stream or no committed deliveries yet.
              </p>
            )}
          </div>
        </RuntimeChartCard>

        <RuntimeChartCard
          title="Stream health"
          subtitle={hasRuntimeObsApi ? 'Stats + health + 1h metrics' : 'Waiting for runtime API'}
          className="lg:col-span-3"
        >
          <ul className="space-y-1.5">
            {streamHealthSignals.map((sig) => (
              <li
                key={sig.label}
                className="flex items-start justify-between gap-2 rounded-md border border-slate-100/90 bg-slate-50/60 px-2 py-1.5 dark:border-gdc-divider dark:bg-gdc-elevated"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{sig.label}</p>
                  {sig.detail ? <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{sig.detail}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {sig.sparkline ? <MiniSparkline values={sig.sparkline} className="text-amber-600 dark:text-amber-400" /> : null}
                  {sig.tone === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden /> : null}
                  <span
                    className={cn(
                      'text-[11px] font-semibold tabular-nums',
                      sig.tone === 'ok' && 'text-emerald-800 dark:text-emerald-300',
                      sig.tone === 'warn' && 'text-amber-800 dark:text-amber-300',
                      sig.tone === 'err' && 'text-red-700 dark:text-red-300',
                      sig.tone === 'neutral' && 'text-slate-600 dark:text-gdc-muted',
                      !sig.tone && 'text-slate-800 dark:text-slate-200',
                    )}
                  >
                    {sig.value}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </RuntimeChartCard>
      </section>

      <section aria-label="Route operational panel">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Routes · Operational</h3>
            <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
              Committed delivery_logs · 1h aggregates · auto-refresh with metrics (30s)
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-semibold">
            {canMutateWorkspace ? (
              <Link to={streamEditPath(streamId)} className="text-violet-700 hover:underline dark:text-violet-300">
                Edit Stream Workflow
              </Link>
            ) : (
              <span className="cursor-not-allowed text-slate-400 dark:text-slate-500" title="Viewer role cannot edit stream configuration.">
                Edit Stream Workflow
              </span>
            )}
            <Link to={NAV_PATH.streams} className="text-violet-700 hover:underline dark:text-violet-300">
              Back to Streams
            </Link>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <RouteOperationalPanel
            streamSlug={streamId}
            backendStreamId={backendStreamId}
            metrics={runtimeMetrics}
            loading={metricsLoading}
            routeToggleBusyId={routeToggleBusyId}
            onToggleEnabled={onToggleRouteEnabled}
            routeActionsReadOnly={!canRuntimeControl}
          />
        </div>
      </section>

      <section aria-label="Recent route failures" className="mt-4">
        <div className="mb-2">
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Recent route failures</h3>
          <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
            destination timeouts, HTTP 5xx, syslog refused, retry exhausted — from committed logs
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <RecentRouteErrorsPanel errors={runtimeMetrics?.recent_route_errors ?? []} loading={metricsLoading && !runtimeMetrics} />
        </div>
      </section>

      {/* History + logs */}
      <section aria-label="Runtime history" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <div className="flex flex-wrap gap-1 border-b border-slate-200/80 px-2 py-2 dark:border-gdc-border">
            {HISTORY_TABS.map((t) => {
              const label = t.key === 'routes' ? `${t.label} (${routesTotal})` : t.label
              const active = historyTab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setHistoryTab(t.key)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                    active
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="p-2">
            {historyTab === 'runHistory' ? (
              <div className="overflow-x-auto">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th scope="col" className={opTh}>
                        Run ID
                      </th>
                      <th scope="col" className={opTh}>
                        Started At
                      </th>
                      <th scope="col" className={opTh}>
                        Duration
                      </th>
                      <th scope="col" className={opTh}>
                        Status
                      </th>
                      <th scope="col" className={opTh}>
                        Events
                      </th>
                      <th scope="col" className={opTh}>
                        Delivered
                      </th>
                      <th scope="col" className={opTh}>
                        Failed
                      </th>
                      <th scope="col" className={cn(opTh, 'text-right')}>
                        Logs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runHistoryRows.map((row) => {
                      const failed = row.failed > 0
                      const partial = row.status === 'Partial'
                      const runLogsHref =
                        backendStreamId != null ? logsExplorerPath({ stream_id: backendStreamId, run_id: row.runId }) : null
                      return (
                        <tr
                          key={row.runId}
                          className={cn(
                            opTr,
                            row.status === 'Failed' && 'bg-red-500/[0.04] dark:bg-red-500/[0.06]',
                            partial && 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]',
                          )}
                        >
                          <td className={opTd}>
                            {runLogsHref ? (
                              <Link
                                to={runLogsHref}
                                className="font-mono text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                              >
                                {row.runId}
                              </Link>
                            ) : (
                              <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-gdc-mutedStrong">
                                {row.runId}
                              </span>
                            )}
                          </td>
                          <td className={cn(opTd, 'whitespace-nowrap tabular-nums text-slate-700 dark:text-gdc-mutedStrong')}>{row.startedAt}</td>
                          <td className={cn(opTd, 'tabular-nums text-slate-600 dark:text-gdc-muted')}>{row.duration}</td>
                          <td className={opTd}>
                            <span className="inline-flex items-center gap-1">
                              {row.status === 'Success' ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                              ) : row.status === 'Failed' ? (
                                <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                              )}
                              <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">{row.status}</span>
                            </span>
                          </td>
                          <td className={cn(opTd, 'tabular-nums font-medium text-slate-800 dark:text-slate-100')}>
                            {row.events.toLocaleString()}
                          </td>
                          <td className={cn(opTd, 'tabular-nums text-slate-700 dark:text-gdc-mutedStrong')}>{row.delivered.toLocaleString()}</td>
                          <td className={cn(opTd, 'tabular-nums font-semibold', failed ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-gdc-mutedStrong')}>
                            {row.failed.toLocaleString()}
                          </td>
                          <td className={cn(opTd, 'text-right')}>
                            {runLogsHref ? (
                              <Link
                                to={runLogsHref}
                                className="inline-flex text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                              >
                                Logs
                              </Link>
                            ) : (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200/90 bg-slate-50/50 px-3 py-8 text-center text-[12px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted">
                <Cpu className="mx-auto mb-2 h-5 w-5 text-slate-400" aria-hidden />
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {historyTab === 'delivery' &&
                    'Per-route delivery attempts and rate-limit signals are summarized in Routes · Operational and in Logs (filter by stage / status).'}
                  {historyTab === 'checkpoint' &&
                    'Checkpoint commit order follows successful destination delivery (spec 002). Use the Checkpoint trace panel above and checkpoint_update rows in Logs.'}
                  {historyTab === 'routes' &&
                    'Route fan-out, toggles, and destination probes are in Routes · Operational. Edit routing from the stream workflow.'}
                  {historyTab === 'logs' && 'Open Logs Explorer scoped to this stream for the full committed delivery_logs tail.'}
                  {historyTab === 'errors' &&
                    'Recent route_send_failed rows are listed under Recent route failures. Use Logs with level=ERROR or stage filters for the full set.'}
                  {historyTab === 'metrics' && 'Charts and KPIs on this page are backed by GET …/metrics when the runtime API is available.'}
                  {historyTab === 'configuration' && 'Read-only configuration is shown in the stream editor; this tab does not duplicate that view.'}
                </p>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted">
                  No additional tab-specific data is loaded here — links above use live APIs only.
                </p>
              </div>
            )}
          </div>
        </div>

        <aside
          role="region"
          aria-label="Recent logs"
          className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
        >
          <div className="border-b border-slate-200/80 px-2.5 py-2 dark:border-gdc-border">
            <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">Recent Logs</p>
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
              {timelineRecentLogs ? 'Runtime timeline sample (delivery_logs)' : 'No timeline rows returned yet for this stream.'}
            </p>
            <div className="mt-2 flex items-center gap-1">
              {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setTimelineLevelFilter(level)}
                  className={cn(
                    'rounded px-1.5 py-px text-[10px] font-semibold',
                    timelineLevelFilter === level
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-700 dark:bg-gdc-elevated dark:text-gdc-mutedStrong',
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          {latestIncident ? (
            <div className="border-b border-slate-200/80 bg-red-500/[0.06] px-2.5 py-1.5 text-[10px] font-medium text-red-800 dark:border-gdc-border dark:bg-red-500/10 dark:text-red-200">
              Latest incident: {latestIncident.message}
            </div>
          ) : null}
          <ul className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {filteredRecentLogLines.length === 0 ? (
              <li className="px-2.5 py-4 text-[11px] text-slate-500">No logs for this filter. Open logs explorer for wider range.</li>
            ) : null}
            {filteredRecentLogLines.map((log, i) => (
              <li key={`${log.at}-${i}`} className="px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium tabular-nums text-slate-500 dark:text-gdc-muted">{log.at}</span>
                  <span
                    className={cn(
                      'rounded px-1 py-px text-[9px] font-bold uppercase',
                      log.level === 'INFO' && 'bg-slate-100 text-slate-700 dark:bg-gdc-elevated dark:text-slate-200',
                      log.level === 'DEBUG' && 'bg-sky-500/10 text-sky-800 dark:text-sky-200',
                      log.level === 'WARN' && 'bg-amber-500/15 text-amber-900 dark:text-amber-200',
                      log.level === 'ERROR' && 'bg-red-500/10 text-red-800 dark:text-red-200',
                    )}
                  >
                    {log.level}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-800 dark:text-slate-200">{log.message}</p>
                <p className="mt-0.5 text-[10px] tabular-nums text-slate-500 dark:text-gdc-muted">{log.duration}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  {(() => {
                    const Icon = stageIcon(log.message)
                    return <Icon className="h-3 w-3 text-slate-400" aria-hidden />
                  })()}
                  <Link to={logsWithFocusHref('runtime')} className="text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                    Open Logs
                  </Link>
                  <Link to={`${streamEditPath(streamId)}?section=delivery`} className="text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                    Check Route
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {backfillOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backfill-modal-title"
          data-testid="stream-backfill-modal"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-gdc-border dark:bg-gdc-card">
            <h3 id="backfill-modal-title" className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Historical replay (backfill)
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
              Replays the selected time window through this stream&apos;s mapping, enrichment, and routes. Production checkpoint is not advanced
              by this job.
            </p>
            <div
              className={cn(
                'mt-3 rounded-lg border px-3 py-2 text-[11px] font-medium',
                bfDryRun
                  ? 'border-sky-200/90 bg-sky-50 text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/35 dark:text-sky-100'
                  : 'border-amber-300/90 bg-amber-500/[0.12] text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100',
              )}
              role="status"
            >
              {bfDryRun ? (
                <>
                  <span className="font-semibold">Dry-run mode</span> — simulates the replay pipeline; destinations are not sent production
                  traffic from this action.
                </>
              ) : (
                <>
                  <span className="font-semibold">Live replay mode</span> — may deliver to configured destinations for historical rows. Confirm
                  the window and downstream impact before running.
                </>
              )}
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200" htmlFor="bf-start">
                Start (local)
              </label>
              <input
                id="bf-start"
                type="datetime-local"
                value={bfStart}
                onChange={(e) => setBfStart(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:[color-scheme:dark]"
              />
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200" htmlFor="bf-end">
                End (local)
              </label>
              <input
                id="bf-end"
                type="datetime-local"
                value={bfEnd}
                onChange={(e) => setBfEnd(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:[color-scheme:dark]"
              />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-2.5 py-2 text-[12px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={bfDryRun}
                  onChange={(e) => setBfDryRun(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  <span className="font-semibold">Dry run</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-600 dark:text-gdc-muted">
                    Dry run only — no events are delivered to destinations during replay.
                  </span>
                </span>
              </label>
            </div>
            {bfError ? (
              <p className="mt-3 text-[12px] font-medium text-red-700 dark:text-red-300" role="alert">
                {bfError}
              </p>
            ) : null}
            {bfResult?.delivery_summary_json ? (
              <div
                className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50 p-3 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
                data-testid="stream-backfill-result"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Replay summary</p>
                <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                  Mode:{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {bfLastWasDryRun === true ? 'Dry-run' : bfLastWasDryRun === false ? 'Live' : '—'}
                  </span>
                  {bfResult.status ? (
                    <>
                      {' '}
                      · Job status: <span className="font-mono font-semibold">{bfResult.status}</span>
                    </>
                  ) : null}
                </p>
                <ul className="mt-2 space-y-1 border-t border-slate-200/80 pt-2 text-slate-800 dark:text-slate-100 dark:border-gdc-divider">
                  <li className="flex justify-between gap-2">
                    <span className="text-slate-600 dark:text-gdc-muted">Delivery outcome</span>
                    <span className="font-mono font-semibold">{String((bfResult.delivery_summary_json as Record<string, unknown>).status ?? '—')}</span>
                  </li>
                  <li className="flex justify-between gap-2 tabular-nums">
                    <span className="text-slate-600 dark:text-gdc-muted">Sent</span>
                    <span>{String((bfResult.delivery_summary_json as Record<string, unknown>).sent ?? '—')}</span>
                  </li>
                  <li className="flex justify-between gap-2 tabular-nums">
                    <span className="text-slate-600 dark:text-gdc-muted">Failed</span>
                    <span className="text-red-700 dark:text-red-300">
                      {String((bfResult.delivery_summary_json as Record<string, unknown>).failed ?? '—')}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2 tabular-nums">
                    <span className="text-slate-600 dark:text-gdc-muted">Skipped</span>
                    <span>{String((bfResult.delivery_summary_json as Record<string, unknown>).skipped ?? '—')}</span>
                  </li>
                </ul>
                {bfResult.error_summary ? (
                  <p className="mt-2 text-[11px] text-red-700 dark:text-red-300">Error: {bfResult.error_summary}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBackfillOpen(false)
                  setBfResult(null)
                  setBfError(null)
                  setBfLastWasDryRun(null)
                }}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200"
              >
                Close
              </button>
              <button
                type="button"
                data-testid="stream-backfill-submit"
                disabled={bfBusy || !bfStart || !bfEnd}
                onClick={() => void executeBackfill()}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {bfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {bfBusy ? 'Running…' : bfDryRun ? 'Run dry-run' : 'Run live replay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="flex items-center gap-2 border-t border-slate-200/70 pt-2 text-[10px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
        <Radio className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        <code className="rounded bg-slate-100 px-0.5 dark:bg-gdc-elevated">GET /api/v1/runtime/streams/&#123;id&#125;/metrics</code> — charts and KPIs use committed
        delivery_logs; timeline sidebar uses delivery_logs sample.
      </p>
    </div>
  )
}
