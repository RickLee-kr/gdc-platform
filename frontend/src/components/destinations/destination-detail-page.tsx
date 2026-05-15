import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  MoreVertical,
  Play,
  RefreshCw,
  Server,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../../lib/utils'
import { NAV_PATH, logsExplorerPath, logsPath, routeEditPath } from '../../config/nav-paths'
import { StatusBadge } from '../shell/status-badge'
import { RuntimeChartCard } from '../shell/runtime-chart-card'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { DestinationOperationalHealthPanel } from './destination-operational-health-panel'
import {
  emptyDestinationDetail,
  type DestinationDetailView,
  type DestinationHealthState,
} from './destination-detail-model'
import { fetchDestinationById, fetchDestinationsList } from '../../api/gdcDestinations'

type MainTab =
  | 'overview'
  | 'routes'
  | 'delivery'
  | 'health'
  | 'failures'
  | 'settings'
  | 'audit'

const TAB_ITEMS: ReadonlyArray<{ key: MainTab; label: string; count?: number }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'routes', label: 'Routes' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'health', label: 'Health' },
  { key: 'failures', label: 'Failures' },
  { key: 'settings', label: 'Settings' },
  { key: 'audit', label: 'Audit Logs' },
]

function healthTone(h: DestinationHealthState): 'success' | 'warning' | 'error' {
  switch (h) {
    case 'HEALTHY':
      return 'success'
    case 'DEGRADED':
      return 'warning'
    case 'ERROR':
      return 'error'
    default: {
      const _e: never = h
      return _e
    }
  }
}

function deliveryActivityTone(s: 'SUCCESS' | 'RETRY' | 'FAILED'): 'success' | 'warning' | 'error' {
  switch (s) {
    case 'SUCCESS':
      return 'success'
    case 'RETRY':
      return 'warning'
    case 'FAILED':
      return 'error'
    default: {
      const _e: never = s
      return _e
    }
  }
}

function failureBadgeClass(code: string): string {
  switch (code) {
    case 'RATE_LIMIT':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200'
    default:
      return 'border-red-500/40 bg-red-500/15 text-red-900 dark:text-red-200'
  }
}

function KpiCard({
  label,
  value,
  trend,
  trendUp,
  trendBad,
}: {
  label: string
  value: string
  trend: string
  trendUp: boolean
  /** When true, up trend is bad (e.g. failures). */
  trendBad?: boolean
}) {
  const good = trendBad ? !trendUp : trendUp
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      <p
        className={cn(
          'mt-1 text-[11px] font-medium',
          good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}
      >
        {trend}
      </p>
    </div>
  )
}

export function DestinationDetailPage() {
  const { destinationId = '' } = useParams<{ destinationId: string }>()
  const backendDestinationNumericId = useMemo(
    () => (/^\d+$/.test(String(destinationId)) ? Number(destinationId) : null),
    [destinationId],
  )
  const [data, setData] = useState<DestinationDetailView>(() => emptyDestinationDetail(destinationId))
  const useApiShell = backendDestinationNumericId != null

  useEffect(() => {
    let cancelled = false
    if (backendDestinationNumericId == null) {
      setData(emptyDestinationDetail(destinationId))
      return
    }
    ;(async () => {
      const [detail, list] = await Promise.all([
        fetchDestinationById(backendDestinationNumericId),
        fetchDestinationsList(),
      ])
      if (cancelled) return
      const base = emptyDestinationDetail(String(backendDestinationNumericId))
      if (!detail) {
        setData(base)
        return
      }
      const listRow = list?.find((d) => d.id === detail.id)
      const cfg = detail.config_json ?? {}
      const host =
        typeof cfg.host === 'string' ? cfg.host : typeof cfg.url === 'string' ? String(cfg.url) : '—'
      const port = cfg.port != null ? String(cfg.port) : '—'
      const health: DestinationHealthState =
        detail.last_connectivity_test_success === false
          ? 'ERROR'
          : detail.last_connectivity_test_success === true
            ? 'HEALTHY'
            : 'DEGRADED'
      setData({
        ...base,
        displayName: detail.name,
        subtitle: `${detail.destination_type.replace(/_/g, ' ')} destination`,
        health,
        routeCount: listRow?.routes?.length ?? listRow?.streams_using_count ?? 0,
        routes: (listRow?.routes ?? []).map((r) => ({
          routeId: String(r.route_id),
          routeName: `Route #${r.route_id}`,
          streamName: r.stream_name,
          deliveryMode: '—',
          status: r.route_enabled === false ? ('PAUSED' as const) : ('ACTIVE' as const),
          epsAvg: 0,
          successRate24h: 0,
        })),
        info: {
          name: detail.name,
          typeLabel: detail.destination_type,
          host,
          port,
          protocol: detail.destination_type.includes('UDP')
            ? 'UDP'
            : detail.destination_type.includes('TCP')
              ? 'TCP'
              : '—',
          messageFormat: detail.destination_type === 'WEBHOOK_POST' ? 'JSON' : 'Syslog',
          createdAt: detail.created_at?.slice(0, 19).replace('T', ' ') ?? '—',
          createdBy: '—',
          lastUpdated: detail.updated_at?.slice(0, 19).replace('T', ' ') ?? '—',
        },
      })
    })()
    return () => {
      cancelled = true
    }
  }, [destinationId, backendDestinationNumericId])

  const [mainTab, setMainTab] = useState<MainTab>('overview')
  const [chartRange, setChartRange] = useState('24h')
  const [moreOpen, setMoreOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const tabsWithCounts = useMemo(() => {
    return TAB_ITEMS.map((t) =>
      t.key === 'routes' ? { ...t, label: `Routes (${data.routeCount})`, count: data.routeCount } : t,
    )
  }, [data.routeCount])

  const runTest = () => {
    setTestBusy(true)
    window.setTimeout(() => setTestBusy(false), 600)
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">{data.displayName}</h2>
            <StatusBadge tone={healthTone(data.health)} className="uppercase">
              {data.health}
            </StatusBadge>
          </div>
          <p className="max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">{data.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testBusy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-70 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
          >
            {testBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            Test Connection
          </button>
          <div className="relative">
            <div className="flex rounded-md shadow-sm">
              <button
                type="button"
                onClick={() => setEditOpen((o) => !o)}
                className="inline-flex h-9 items-center rounded-l-md border border-slate-200/90 bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 dark:border-violet-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setEditOpen((o) => !o)}
                className="inline-flex h-9 items-center rounded-r-md border border-l-0 border-slate-200/90 bg-violet-600 px-2 text-white hover:bg-violet-700 dark:border-violet-700"
                aria-label="Edit options"
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {editOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-slate-200/90 bg-white py-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
                  onClick={() => setEditOpen(false)}
                >
                  Edit connection
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
                  onClick={() => setEditOpen(false)}
                >
                  Duplicate destination
                </button>
              </div>
            ) : null}
          </div>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
              aria-expanded={moreOpen}
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
              More
            </button>
            {moreOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-slate-200/90 bg-white py-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
                  onClick={() => setMoreOpen(false)}
                >
                  Rotate credentials
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[12px] hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
                  onClick={() => setMoreOpen(false)}
                >
                  Disable destination
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200/80 pb-px dark:border-gdc-border">
        {tabsWithCounts.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMainTab(t.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors',
              mainTab === t.key
                ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-gdc-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mainTab !== 'overview' ? (
        <section
          role="region"
          aria-label={`${mainTab} tab`}
          className="rounded-xl border border-dashed border-slate-200/90 bg-slate-50/50 px-4 py-8 text-center dark:border-gdc-border dark:bg-gdc-card"
        >
          <Server className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
          <p className="mt-2 text-[13px] font-semibold text-slate-800 dark:text-slate-200">
            {tabsWithCounts.find((x) => x.key === mainTab)?.label ?? mainTab}
          </p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">
            This tab will load delivery telemetry and configuration from runtime APIs.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            {backendDestinationNumericId != null ? (
              <DestinationOperationalHealthPanel destinationId={backendDestinationNumericId} />
            ) : null}
            {!useApiShell ? (
            <>
            <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-label="Destination KPI summary">
              <KpiCard
                label="Delivery (24h)"
                value={`${(data.kpi.delivery24h / 1_000_000).toFixed(2)}M events`}
                trend={data.kpi.delivery24hTrend}
                trendUp={data.kpi.delivery24hTrendUp}
              />
              <KpiCard
                label="Success Rate (24h)"
                value={`${data.kpi.successRate24h.toFixed(2)}%`}
                trend={data.kpi.successRateTrend}
                trendUp={data.kpi.successRateTrendUp}
              />
              <KpiCard
                label="Avg Latency (24h)"
                value={`${data.kpi.avgLatencyMs24h} ms`}
                trend={data.kpi.latencyTrendLabel}
                trendUp={data.kpi.latencyTrendGood}
              />
              <KpiCard
                label="Throughput (avg)"
                value={`${data.kpi.throughputEps.toLocaleString()} EPS`}
                trend={data.kpi.throughputTrend}
                trendUp={data.kpi.throughputTrendUp}
              />
              <KpiCard
                label="Failed Events (24h)"
                value={data.kpi.failed24h.toLocaleString()}
                trend={data.kpi.failedTrend}
                trendUp={data.kpi.failedTrendBad}
                trendBad
              />
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <RuntimeChartCard title="Events Over Time" subtitle="Success vs failed deliveries">
                <div className="mb-2 flex justify-end">
                  <label className="sr-only" htmlFor="dest-chart-range">
                    Chart time range
                  </label>
                  <select
                    id="dest-chart-range"
                    value={chartRange}
                    onChange={(e) => setChartRange(e.target.value)}
                    className="h-8 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-medium dark:border-gdc-border dark:bg-gdc-card"
                  >
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                  </select>
                </div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...data.eventsOverTime]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/80 dark:stroke-gdc-divider" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis width={44} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="success" name="Success" stroke="#7c3aed" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </RuntimeChartCard>

              <RuntimeChartCard title="Latency (ms)" subtitle="End-to-end delivery latency">
                <div className="mb-2 flex justify-end">
                  <select
                    aria-label="Latency chart range"
                    value={chartRange}
                    onChange={(e) => setChartRange(e.target.value)}
                    className="h-8 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-medium dark:border-gdc-border dark:bg-gdc-card"
                  >
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                  </select>
                </div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[...data.latencyOverTime]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="destLatFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/80 dark:stroke-gdc-divider" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis width={40} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [`${v} ms`, 'Latency']} />
                      <Area type="monotone" dataKey="ms" stroke="#7c3aed" strokeWidth={2} fill="url(#destLatFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </RuntimeChartCard>
            </div>
            </>
            ) : null}

            <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <div className="border-b border-slate-200/70 px-3 py-2 dark:border-gdc-border">
                <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Routes Using This Destination</h3>
              </div>
              <div className="overflow-x-auto">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={opTh} scope="col">
                        Route Name
                      </th>
                      <th className={opTh} scope="col">
                        Stream
                      </th>
                      <th className={opTh} scope="col">
                        Delivery Mode
                      </th>
                      <th className={opTh} scope="col">
                        Status
                      </th>
                      <th className={cn(opTh, 'tabular-nums')} scope="col">
                        EPS (avg)
                      </th>
                      <th className={cn(opTh, 'tabular-nums')} scope="col">
                        Success Rate (24h)
                      </th>
                      <th className={cn(opTh, 'text-right')} scope="col">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.routes.map((r) => (
                      <tr key={r.routeId} className={opTr}>
                        <td className={cn(opTd, 'font-medium text-slate-900 dark:text-slate-100')}>{r.routeName}</td>
                        <td className={opTd}>{r.streamName}</td>
                        <td className={opTd}>{r.deliveryMode}</td>
                        <td className={opTd}>
                          <StatusBadge tone={r.status === 'ACTIVE' ? 'success' : r.status === 'ERROR' ? 'error' : 'warning'} className="uppercase">
                            {r.status}
                          </StatusBadge>
                        </td>
                        <td className={cn(opTd, 'tabular-nums')}>{r.epsAvg.toLocaleString()}</td>
                        <td className={cn(opTd, 'tabular-nums')}>{r.successRate24h.toFixed(2)}%</td>
                        <td className={cn(opTd, 'text-right')}>
                          <Link
                            to={routeEditPath(r.routeId)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                          >
                            View Route
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
                <span>
                  Total <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{data.routeCount}</span> routes
                </span>
                <div className="flex items-center gap-2">
                  <span>10 / page</span>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <div className="border-b border-slate-200/70 px-3 py-2 dark:border-gdc-border">
                <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Recent Delivery Activity</h3>
              </div>
              <div className="overflow-x-auto">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={opTh} scope="col">
                        Time
                      </th>
                      <th className={opTh} scope="col">
                        Route
                      </th>
                      <th className={opTh} scope="col">
                        Status
                      </th>
                      <th className={cn(opTh, 'tabular-nums')} scope="col">
                        Events
                      </th>
                      <th className={cn(opTh, 'tabular-nums')} scope="col">
                        Latency
                      </th>
                      <th className={opTh} scope="col">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentActivity.map((row) => (
                      <tr key={row.id} className={opTr}>
                        <td className={cn(opTd, 'whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-gdc-muted')}>{row.time}</td>
                        <td className={opTd}>{row.routeName}</td>
                        <td className={opTd}>
                          <StatusBadge tone={deliveryActivityTone(row.status)} className="uppercase">
                            {row.status}
                          </StatusBadge>
                        </td>
                        <td className={cn(opTd, 'tabular-nums')}>{row.events.toLocaleString()}</td>
                        <td className={cn(opTd, 'tabular-nums')}>{row.latencyMs} ms</td>
                        <td className={cn(opTd, 'max-w-[280px] truncate text-[11px] text-slate-600 dark:text-gdc-muted')}>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200/80 px-3 py-2 dark:border-gdc-border">
                <Link
                  to={
                    backendDestinationNumericId != null
                      ? logsExplorerPath({ destination_id: backendDestinationNumericId })
                      : logsPath()
                  }
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                >
                  View all delivery logs
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-24 xl:self-start">
            <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Destination Info</h3>
                <button type="button" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                  Edit
                </button>
              </div>
              <dl className="mt-3 space-y-2 text-[12px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Name</dt>
                  <dd className="max-w-[60%] text-right font-medium text-slate-900 dark:text-slate-100">{data.info.name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Type</dt>
                  <dd className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">{data.info.typeLabel}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Host</dt>
                  <dd className="font-mono text-[11px]">{data.info.host}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Port</dt>
                  <dd className="font-mono tabular-nums">{data.info.port}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Protocol</dt>
                  <dd>{data.info.protocol}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Message Format</dt>
                  <dd>{data.info.messageFormat}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Created At</dt>
                  <dd className="text-right text-[11px]">{data.info.createdAt}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Created By</dt>
                  <dd className="truncate text-[11px]">{data.info.createdBy}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-gdc-muted">Last Updated</dt>
                  <dd className="text-right text-[11px]">{data.info.lastUpdated}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Health Status</h3>
              <div className="mt-3 flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <div className="min-w-0">
                  <StatusBadge tone={healthTone(data.health)} className="uppercase">
                    {data.health}
                  </StatusBadge>
                  <p className="mt-2 text-[12px] leading-snug text-slate-600 dark:text-gdc-muted">{data.healthPanel.summary}</p>
                  <ul className="mt-3 space-y-1.5 text-[11px]">
                    <li className="flex justify-between gap-2">
                      <span className="text-slate-500">Last Check</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{data.healthPanel.lastCheckRelative}</span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span className="text-slate-500">Uptime (7d)</span>
                      <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{data.healthPanel.uptime7dPct}%</span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span className="text-slate-500">Packet Loss (24h)</span>
                      <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{data.healthPanel.packetLoss24hPct}%</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Failures</h3>
                <Link
                  to={backendDestinationNumericId != null ? logsExplorerPath({ destination_id: backendDestinationNumericId }) : logsPath()}
                  className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                >
                  View All
                </Link>
              </div>
              <ul className="mt-3 space-y-3">
                {data.recentFailures.map((f) => (
                  <li key={f.id} className="border-b border-slate-100 pb-3 last:border-0 dark:border-gdc-border">
                    <p className="font-mono text-[10px] text-slate-500 dark:text-gdc-muted">{f.at}</p>
                    <span
                      className={cn(
                        'mt-1 inline-flex rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                        failureBadgeClass(f.code),
                      )}
                    >
                      {f.code}
                    </span>
                    <p className="mt-1 text-[11px] font-medium text-slate-800 dark:text-slate-200">{f.routeName}</p>
                    <p className="text-[11px] text-slate-600 dark:text-gdc-muted">{f.failedEvents.toLocaleString()} events failed</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick Actions</h3>
              <ul className="mt-3 space-y-1">
                <li>
                  <button
                    type="button"
                    onClick={runTest}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
                  >
                    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Test Connection
                  </button>
                </li>
                <li>
                  <Link
                    to={NAV_PATH.routes}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  >
                    <Activity className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                    View Routes ({data.routeCount})
                  </Link>
                </li>
                <li>
                  <Link
                    to={
                      backendDestinationNumericId != null
                        ? logsExplorerPath({ destination_id: backendDestinationNumericId })
                        : logsPath()
                    }
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                    View Delivery Logs
                  </Link>
                </li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
