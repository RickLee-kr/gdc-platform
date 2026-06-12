import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  CheckCircle2,
  Database,
  Gauge,
  Layers,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { NAV_PATH } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { formatThroughputEps } from '../../lib/observability-format'
import type { RuntimeAlertSummaryItem } from '../../api/types/gdcApi'
import {
  dashboardCardClass,
  type DashboardKpiItem,
  type FlowBreakdown,
  type FlowLaneCounts,
  type RecentAlertsSummary,
  type StreamsOperationalStatus,
  type SystemHealthItem,
  type TopSourceIngestItem,
  type OverallHealthCounts,
  type TrafficChartPoint,
  donutSlicesFromCounts,
  formatMetricCount,
  formatSuccessRate,
  operationalStatusDonutSlices,
} from './dashboard-charter-metrics'

function postureHeroClass(posture: OverallHealthCounts['posture']): string {
  if (posture === 'critical') {
    return 'border-red-500/40 bg-gradient-to-r from-red-950/50 via-red-900/20 to-transparent shadow-[0_0_16px_-6px_rgba(239,68,68,0.35)]'
  }
  if (posture === 'warning') {
    return 'border-amber-500/35 bg-gradient-to-r from-amber-950/45 via-amber-900/15 to-transparent shadow-[0_0_14px_-6px_rgba(245,158,11,0.3)]'
  }
  return 'border-emerald-500/35 bg-gradient-to-r from-emerald-950/40 via-emerald-900/12 to-transparent shadow-[0_0_14px_-6px_rgba(34,197,94,0.28)]'
}

function postureLabel(posture: OverallHealthCounts['posture']): string {
  if (posture === 'critical') return 'Critical'
  if (posture === 'warning') return 'Warning'
  return 'Healthy'
}

const KPI_SPARK: Record<DashboardKpiItem['tone'], string> = {
  blue: '#38bdf8',
  green: '#34d399',
  violet: '#a78bfa',
  teal: '#2dd4bf',
  amber: '#fbbf24',
  red: '#f87171',
  neutral: '#94a3b8',
}

const KPI_ICON: Record<DashboardKpiItem['id'], typeof Layers> = {
  'active-streams': Layers,
  'ingest-rate': ArrowDownToLine,
  'delivery-rate': ArrowUpFromLine,
  'success-rate': Gauge,
  'active-alerts': Bell,
}

const KPI_ICON_BG: Record<DashboardKpiItem['tone'], string> = {
  blue: 'bg-sky-500/15 text-sky-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  violet: 'bg-violet-500/15 text-violet-400',
  teal: 'bg-teal-500/15 text-teal-400',
  amber: 'bg-amber-500/15 text-amber-400',
  red: 'bg-red-500/15 text-red-400',
  neutral: 'bg-slate-500/15 text-slate-400',
}

export function DashboardRunningBadge({
  engineStatus,
  posture,
}: {
  engineStatus?: string | null
  posture: 'healthy' | 'warning' | 'critical'
}) {
  const running = engineStatus === 'RUNNING' || engineStatus == null

  return (
    <div
      data-testid="dashboard-running-badge"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold',
        running && posture === 'healthy'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : running
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
            : posture === 'critical'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            running ? 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]' : 'bg-amber-400',
          )}
          aria-hidden
        />
        {running ? 'RUNNING' : String(engineStatus ?? 'IDLE')}
      </span>
      {running && posture === 'healthy' ? (
        <>
          <span className="text-slate-600 dark:text-slate-500" aria-hidden>
            |
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            All Systems Operational
          </span>
        </>
      ) : null}
    </div>
  )
}

export function OverallHealthHero({
  health,
  windowLabel,
}: {
  health: OverallHealthCounts
  windowLabel: string
}) {
  return (
    <section
      aria-label="Overall health hero"
      data-testid="dashboard-overall-health-hero"
      className={cn(
        'relative overflow-hidden rounded-xl border px-4 py-2.5',
        postureHeroClass(health.posture),
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {health.posture === 'healthy' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          ) : (
            <AlertTriangle
              className={cn('h-4 w-4 shrink-0', health.posture === 'critical' ? 'text-red-400' : 'text-amber-400')}
              aria-hidden
            />
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Overall health</p>
            <p
              className={cn(
                'text-lg font-bold leading-tight tracking-tight',
                health.posture === 'critical' ? 'text-red-300' : health.posture === 'warning' ? 'text-amber-300' : 'text-emerald-300',
              )}
              data-testid="dashboard-overall-posture-label"
            >
              {postureLabel(health.posture)}
            </p>
          </div>
          <span className="hidden text-[10px] text-slate-500 sm:inline">· {windowLabel}</span>
        </div>

        <div className="flex gap-2 sm:gap-3" data-testid="dashboard-overall-health">
          {(
            [
              ['Healthy', health.healthy, 'healthy', 'dashboard-health-healthy'],
              ['Warning', health.warning, 'warning', 'dashboard-health-warning'],
              ['Critical', health.critical, 'critical', 'dashboard-health-critical'],
            ] as const
          ).map(([label, count, tone, testId]) => (
            <Link
              key={testId}
              to={NAV_PATH.streams}
              data-testid={testId}
              className={cn(
                'min-w-[4.5rem] rounded-lg border px-2.5 py-1 text-center transition hover:brightness-110',
                tone === 'healthy' && 'border-emerald-500/30 bg-emerald-500/10',
                tone === 'warning' && 'border-amber-500/30 bg-amber-500/10',
                tone === 'critical' && 'border-red-500/35 bg-red-500/10',
              )}
            >
              <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p
                className={cn(
                  'mt-0.5 text-lg font-bold tabular-nums leading-none',
                  tone === 'healthy' && 'text-emerald-300',
                  tone === 'warning' && 'text-amber-300',
                  tone === 'critical' && 'text-red-300',
                )}
              >
                {formatMetricCount(count)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function parseKpiTrend(sub: string): { badge: string; footnote: string } {
  const vsIdx = sub.indexOf(' vs last ')
  if (vsIdx === -1) return { badge: sub, footnote: '' }
  return { badge: sub.slice(0, vsIdx).trim(), footnote: sub.slice(vsIdx + 1).trim() }
}

function splitKpiValue(value: string): { primary: string; unit: string | null } {
  const match = value.match(/^(.+?)\s+(events\/sec)$/)
  if (match) return { primary: match[1], unit: match[2] }
  return { primary: value, unit: null }
}

function MiniSparkline({ values, color, sparkId }: { values: number[]; color: string; sparkId: string }) {
  const data =
    values.length > 1
      ? values.map((y, i) => ({ i, y }))
      : [{ i: 0, y: values[0] ?? 0 }, { i: 1, y: values[0] ?? 0 }]
  const gradId = `kpi-spark-${sparkId}`
  return (
    <div className="mt-auto h-9 w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DashboardKpiStrip({ items }: { items: DashboardKpiItem[] }) {
  return (
    <section aria-label="Dashboard KPI strip" data-testid="dashboard-kpi-strip" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((kpi) => {
        const Icon = KPI_ICON[kpi.id] ?? Activity
        const { primary, unit } = splitKpiValue(kpi.value)
        const { badge, footnote } = parseKpiTrend(kpi.sub)
        const subPositive = badge.startsWith('↑') || badge.startsWith('↗') || badge.startsWith('+')
        const subNegative = badge.startsWith('↓') || badge.startsWith('↘') || badge.startsWith('-')
        const isAlertKpi = kpi.id === 'active-alerts'
        return (
          <div
            key={kpi.id}
            className={cn(dashboardCardClass, 'flex min-h-[7.25rem] flex-col')}
            data-testid={`dashboard-kpi-${kpi.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] font-medium text-slate-400 dark:text-slate-400">{kpi.label}</p>
              <span className={cn('inline-flex rounded-lg p-1.5', KPI_ICON_BG[kpi.tone])} aria-hidden>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-[1.75rem] font-bold tabular-nums leading-none tracking-tight text-slate-50">
              {primary}
              {unit ? <span className="ml-1 text-[12px] font-normal text-slate-500 dark:text-slate-500">{unit}</span> : null}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {isAlertKpi ? (
                <p
                  className={cn(
                    'text-[11px] font-medium leading-tight',
                    kpi.tone === 'red' ? 'text-red-400' : kpi.tone === 'amber' ? 'text-amber-400' : 'text-slate-500 dark:text-slate-500',
                  )}
                >
                  {kpi.sub}
                </p>
              ) : badge !== '—' && badge !== '0' ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 text-[11px] font-medium',
                    subPositive && 'text-emerald-400',
                    subNegative && 'text-red-400',
                    !subPositive && !subNegative && 'text-slate-500',
                  )}
                >
                  {subPositive ? <TrendingUp className="h-3 w-3" aria-hidden /> : null}
                  {subNegative ? <TrendingDown className="h-3 w-3" aria-hidden /> : null}
                  {badge}
                </span>
              ) : null}
              {footnote ? <span className="text-[11px] text-slate-500 dark:text-slate-500">{footnote}</span> : null}
            </div>
            {kpi.sparkline.length > 0 ? <MiniSparkline values={kpi.sparkline} color={KPI_SPARK[kpi.tone]} sparkId={kpi.id} /> : null}
          </div>
        )
      })}
    </section>
  )
}

const FLOW_GRAPH_HEIGHT = 176
const FLOW_LANE_COL = 'w-[7rem] shrink-0 sm:w-[7.5rem] md:w-[8.5rem]'
const FLOW_BAND_COL = 'h-[11rem] w-full min-w-[5rem]'
const FLOW_GRAPH_GRID =
  'grid w-full grid-cols-[7rem_minmax(5rem,2.5fr)_auto_minmax(5rem,2.5fr)_7rem] items-center gap-x-2 sm:grid-cols-[7.5rem_minmax(5.5rem,3fr)_auto_minmax(5.5rem,3fr)_7.5rem] sm:gap-x-3 md:grid-cols-[8.5rem_minmax(6rem,3.5fr)_auto_minmax(6rem,3.5fr)_8.5rem]'
const FLOW_BAND_MIN = 3
const FLOW_BAND_MAX = 5

function flowBandCount(itemCount: number): number {
  if (itemCount <= 0) return FLOW_BAND_MIN
  return Math.min(FLOW_BAND_MAX, Math.max(FLOW_BAND_MIN, itemCount))
}

function flowLaneAnchors(count: number, height: number, padding = 10): number[] {
  const n = Math.max(1, count)
  const usable = height - padding * 2
  return Array.from({ length: n }, (_, i) => padding + (usable * (i + 0.5)) / n)
}

function sankeyRibbonPath(
  xStart: number,
  xEnd: number,
  yStart: number,
  wStart: number,
  yEnd: number,
  wEnd: number,
): string {
  const topStart = yStart - wStart / 2
  const botStart = yStart + wStart / 2
  const topEnd = yEnd - wEnd / 2
  const botEnd = yEnd + wEnd / 2
  const span = xEnd - xStart
  const curve = span * 0.44
  const c1x = xStart + curve
  const c2x = xEnd - curve
  return [
    `M ${xStart} ${topStart}`,
    `C ${c1x} ${topStart} ${c2x} ${topEnd} ${xEnd} ${topEnd}`,
    `L ${xEnd} ${botEnd}`,
    `C ${c2x} ${botEnd} ${c1x} ${botStart} ${xStart} ${botStart}`,
    'Z',
  ].join(' ')
}

const FLOW_BAND_GRADIENTS_LEFT = [
  { from: '#0ea5e9', to: '#34d399' },
  { from: '#38bdf8', to: '#2dd4bf' },
  { from: '#22d3ee', to: '#34d399' },
  { from: '#06b6d4', to: '#10b981' },
  { from: '#7dd3fc', to: '#34d399' },
] as const

const FLOW_BAND_GRADIENTS_RIGHT = [
  { from: '#34d399', to: '#a78bfa' },
  { from: '#2dd4bf', to: '#c084fc' },
  { from: '#10b981', to: '#8b5cf6' },
  { from: '#34d399', to: '#9333ea' },
  { from: '#6ee7b7', to: '#a78bfa' },
] as const

function buildFlowBands(
  items: Array<{ label: string; count: number }>,
): Array<{ yLane: number; yStream: number; wLane: number; wStream: number; index: number }> {
  const itemCount = items.length
  const bandCount = flowBandCount(itemCount)
  const laneAnchors = flowLaneAnchors(itemCount > 0 ? itemCount : 1, FLOW_GRAPH_HEIGHT)
  const streamCenter = FLOW_GRAPH_HEIGHT / 2
  const totalCount = items.reduce((sum, item) => sum + item.count, 0) || 1
  const streamSpread = itemCount <= 1 ? 14 : 8
  const laneSpread = itemCount <= 1 ? 6 : 0

  return Array.from({ length: bandCount }, (_, index) => {
    const itemIdx =
      itemCount > 0 ? Math.min(itemCount - 1, Math.round((index * (itemCount - 1)) / Math.max(1, bandCount - 1))) : 0
    const weight = itemCount > 0 ? items[itemIdx].count / totalCount : 1 / bandCount
    const laneOffset = (index - (bandCount - 1) / 2) * laneSpread
    const streamOffset = (index - (bandCount - 1) / 2) * streamSpread
    const wLane = 10 + weight * 18 + (index % 2) * 3
    const wStream = 8 + weight * 12 + (index % 2) * 2
    const yLane = itemCount > 0 ? laneAnchors[itemIdx] + laneOffset : streamCenter + laneOffset
    const yStream = streamCenter + streamOffset
    return { yLane, yStream, wLane, wStream, index }
  })
}

function SankeyRibbonField({
  side,
  items,
}: {
  side: 'left' | 'right'
  items: Array<{ label: string; count: number }>
}) {
  const height = FLOW_GRAPH_HEIGHT
  const width = 100
  const bands = buildFlowBands(items)
  const xLane = side === 'left' ? 0 : width
  const xStream = side === 'left' ? width : 0
  const gradients = side === 'left' ? FLOW_BAND_GRADIENTS_LEFT : FLOW_BAND_GRADIENTS_RIGHT
  const gradPrefix = `flow-${side}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn(FLOW_BAND_COL)}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
      data-testid={`dashboard-data-flow-bands-${side}`}
    >
      <defs>
        {bands.map((band) => (
          <linearGradient
            key={band.index}
            id={`${gradPrefix}-g-${band.index}`}
            x1={side === 'left' ? '0%' : '100%'}
            y1="0%"
            x2={side === 'left' ? '100%' : '0%'}
            y2="0%"
          >
            <stop offset="0%" stopColor={gradients[band.index % gradients.length].from} stopOpacity="0.55" />
            <stop offset="100%" stopColor={gradients[band.index % gradients.length].to} stopOpacity="0.68" />
          </linearGradient>
        ))}
      </defs>
      {bands.map((band) => (
        <path
          key={band.index}
          d={sankeyRibbonPath(
            xLane,
            xStream,
            side === 'left' ? band.yLane : band.yStream,
            side === 'left' ? band.wLane : band.wStream,
            side === 'left' ? band.yStream : band.yLane,
            side === 'left' ? band.wStream : band.wLane,
          )}
          fill={`url(#${gradPrefix}-g-${band.index})`}
          opacity={0.88}
        />
      ))}
    </svg>
  )
}

function FlowEndpointHeader({
  title,
  total,
  tone,
  align = 'left',
}: {
  title: string
  total: number
  tone: 'sky' | 'violet'
  align?: 'left' | 'right'
}) {
  const iconClass = tone === 'sky' ? 'text-sky-400' : 'text-violet-400'
  const labelClass = tone === 'sky' ? 'text-sky-300/90' : 'text-violet-300/90'

  return (
    <div className={cn('flex w-full min-w-0 items-center gap-1.5', align === 'right' && 'justify-end text-right')}>
      <Database className={cn('h-5 w-5 shrink-0', iconClass)} aria-hidden />
      <span className={cn('text-[13px] font-semibold', labelClass)}>{title}</span>
      <span className="text-2xl font-bold tabular-nums leading-none text-slate-50">{formatMetricCount(total)}</span>
    </div>
  )
}

function FlowCategoryList({
  items,
  total,
  title,
  tone,
}: {
  items: Array<{ label: string; count: number }>
  total: number
  title: string
  tone: 'sky' | 'violet'
  align?: 'left' | 'right'
}) {
  const labelClass = tone === 'sky' ? 'text-sky-300/85' : 'text-violet-300/85'
  const countClass = tone === 'sky' ? 'text-sky-200' : 'text-violet-200'
  const displayItems = items.length > 0 ? items : [{ label: title.slice(0, -1), count: total }]
  const anchors = flowLaneAnchors(displayItems.length, FLOW_GRAPH_HEIGHT)

  return (
    <ul className="relative w-full" style={{ height: FLOW_GRAPH_HEIGHT }}>
      {displayItems.map((item, index) => (
        <li
          key={item.label}
          className="absolute left-0 right-0 flex -translate-y-1/2 items-center justify-between gap-3 text-[11px] leading-tight"
          style={{ top: anchors[index] }}
        >
          <span className={cn('min-w-0 truncate font-medium', labelClass)}>{item.label}</span>
          <span className={cn('shrink-0 pl-2 font-bold tabular-nums', countClass)}>{item.count}</span>
        </li>
      ))}
    </ul>
  )
}

function StreamsFlowHub() {
  return (
    <div
      className="flex h-10 w-14 shrink-0 items-center justify-center rounded-full border border-emerald-500/55 bg-emerald-500/20 shadow-[0_0_18px_-2px_rgba(52,211,153,0.55)] sm:h-11 sm:w-16"
      data-testid="dashboard-data-flow-streams-pill"
    >
      <Activity className="h-4 w-4 text-emerald-100 sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden />
    </div>
  )
}

export function DataFlowOverview({ flow, breakdown }: { flow: FlowLaneCounts; breakdown: FlowBreakdown }) {
  const sourceTotal = flow.sources
  const destTotal = flow.destinations

  return (
    <section
      aria-label="Data flow overview"
      data-testid="dashboard-data-flow"
      className={cn(dashboardCardClass, 'lg:col-span-7')}
    >
      <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Data Flow Overview</h2>
      <p className="text-[11px] text-slate-500 dark:text-gdc-muted">{flow.routes} delivery paths configured</p>

      <div className="mx-auto mt-3 w-full min-w-0">
        <div className="flex w-full items-end justify-between gap-3">
          <div className={FLOW_LANE_COL}>
            <FlowEndpointHeader title="Sources" total={sourceTotal} tone="sky" />
          </div>
          <div className="flex shrink-0 items-baseline justify-center gap-1.5 px-1">
            <span className="text-[13px] font-semibold text-emerald-400">Streams</span>
            <span className="text-2xl font-bold tabular-nums leading-none text-slate-50">{formatMetricCount(breakdown.streams)}</span>
          </div>
          <div className={cn(FLOW_LANE_COL, 'flex justify-end')}>
            <FlowEndpointHeader title="Destinations" total={destTotal} tone="violet" align="right" />
          </div>
        </div>

        <div className={cn(FLOW_GRAPH_GRID, 'mx-auto mt-2')}>
          <div className={FLOW_LANE_COL}>
            <FlowCategoryList items={breakdown.sources} total={sourceTotal} title="Sources" tone="sky" />
          </div>
          <SankeyRibbonField side="left" items={breakdown.sources} />
          <StreamsFlowHub />
          <SankeyRibbonField side="right" items={breakdown.destinations} />
          <div className={cn(FLOW_LANE_COL, 'justify-self-end')}>
            <FlowCategoryList
              items={breakdown.destinations}
              total={destTotal}
              title="Destinations"
              tone="violet"
              align="right"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

export function EventsOverTimeChart({
  series,
  windowLabel,
  loading,
}: {
  series: TrafficChartPoint[]
  windowLabel: string
  loading: boolean
}) {
  const empty = series.length === 0 || series.every((p) => p.ingested + p.delivered + p.failed === 0)

  return (
    <section
      aria-label="Events over time"
      data-testid="dashboard-events-over-time"
      className={cn(dashboardCardClass, 'lg:col-span-5', loading && 'opacity-80')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Events Over Time</h2>
        <span className="text-[10px] font-medium text-slate-500 dark:text-gdc-muted">{windowLabel}</span>
      </div>
      <div className="mt-2 h-[13rem] w-full">
        {empty && !loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500 dark:text-gdc-muted">No events in this window.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
              <defs>
                <linearGradient id="dash-ingested-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="dash-delivered-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="dash-failed-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#f87171" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="ingested" name="Ingested" stroke="#38bdf8" strokeWidth={2.5} fill="url(#dash-ingested-fill)" dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#34d399" strokeWidth={2.5} fill="url(#dash-delivered-fill)" dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="failed" name="Failed" stroke="#f87171" strokeWidth={2} fill="url(#dash-failed-fill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500 dark:text-gdc-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> Ingested</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Delivered</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" /> Failed</span>
      </div>
    </section>
  )
}

function DonutPanel({
  title,
  totalLabel,
  slices,
  testId,
  footer,
}: {
  title: string
  totalLabel: string
  slices: Array<{ name: string; value: number; color: string; pct: number }>
  testId: string
  footer?: ReactNode
}) {
  const total = slices.reduce((a, s) => a + s.value, 0)

  return (
    <section aria-label={title} data-testid={testId} className={dashboardCardClass}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {footer}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative h-[8.5rem] w-[8.5rem] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none">
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [`${value}`, String(name)]}
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatMetricCount(total)}</p>
            <p className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{totalLabel}</p>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {slices.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-1.5 text-[11px]">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500 dark:text-gdc-muted">
                {formatMetricCount(s.value)} <span className="text-[9px]">({s.pct.toFixed(1)}%)</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function StreamsStatusDonut({ status }: { status: StreamsOperationalStatus }) {
  const slices = operationalStatusDonutSlices(status)
  return (
    <DonutPanel
      title="Streams by Status"
      totalLabel="Total"
      slices={slices}
      testId="dashboard-streams-by-status"
      footer={
        <Link to={NAV_PATH.streams} className="text-[10px] font-semibold text-violet-600 hover:underline dark:text-violet-300">
          View all streams →
        </Link>
      }
    />
  )
}

export function TopSourcesByIngestRatePanel({ sources }: { sources: TopSourceIngestItem[] }) {
  const max = Math.max(1, ...sources.map((s) => s.rateEps))

  return (
    <section aria-label="Top sources by ingest rate" data-testid="dashboard-top-sources" className={dashboardCardClass}>
      <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Top Sources by Ingest Rate</h2>
      {sources.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted">No source throughput data in this window.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {sources.map((source) => {
            const pct = (100 * source.rateEps) / max
            const rateLabel =
              source.rateEps >= 1000
                ? `${formatMetricCount(Math.round(source.rateEps))}/s`
                : `${formatThroughputEps(source.rateEps)}/s`
            return (
              <li key={source.name}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium text-slate-200">{source.name}</span>
                  <span className="shrink-0 tabular-nums font-semibold text-sky-400">{rateLabel}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all"
                    style={{ width: `${Math.max(source.rateEps > 0 ? 8 : 0, pct)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function fmtAlertTime(iso: string): string {
  try {
    const d = new Date(iso)
    const diffMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000))
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin} min ago`
    return `${Math.floor(diffMin / 60)}h ago`
  } catch {
    return iso
  }
}

export function RecentAlertsPanel({
  summary,
  items,
}: {
  summary: RecentAlertsSummary
  items: RuntimeAlertSummaryItem[]
}) {
  const top = items.slice(0, 2)

  return (
    <section aria-label="Recent alerts" data-testid="dashboard-recent-alerts" className={dashboardCardClass}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Recent Alerts</h2>
        <Link to={NAV_PATH.streams} className="text-[11px] font-semibold text-violet-400 hover:underline">
          View all →
        </Link>
      </div>

      {summary.hasAlerts ? (
        <ul className="mt-3 space-y-2">
          {top.map((item, i) => (
            <li key={`${item.stream_id}-${item.latest_occurrence}-${i}`}>
              <Link
                to={NAV_PATH.streams}
                className="flex gap-2.5 rounded-lg border border-slate-700/50 bg-slate-900/20 px-2.5 py-2 transition hover:border-violet-500/35 dark:bg-gdc-section/30"
              >
                {item.severity === 'ERROR' ? (
                  <span className="shrink-0 self-start rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-red-300">
                    Critical
                  </span>
                ) : (
                  <span className="shrink-0 self-start rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-300">
                    Warning
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-slate-100">{item.stream_name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {item.severity === 'ERROR' ? 'High error rate detected' : 'Delivery latency higher than normal'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {item.count} events · {fmtAlertTime(item.latest_occurrence)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] text-slate-500 dark:text-gdc-muted">No active alerts in this window.</p>
      )}
    </section>
  )
}

function systemHealthStatusLabel(status: SystemHealthItem['status']): string {
  if (status === 'healthy') return 'Healthy'
  if (status === 'warning') return 'Warning'
  return 'Critical'
}

function SystemHealthStatusIcon({ status }: { status: SystemHealthItem['status'] }) {
  const healthy = status === 'healthy'
  const warning = status === 'warning'

  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-full',
        healthy && 'bg-emerald-500/20',
        warning && 'bg-amber-500/20',
        !healthy && !warning && 'bg-red-500/20',
      )}
      aria-hidden
    >
      {healthy ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : warning ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400" />
      )}
    </span>
  )
}

export function SystemHealthBar({ items }: { items: SystemHealthItem[] }) {
  return (
    <section
      aria-label="System health"
      data-testid="dashboard-system-health"
      className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 dark:border-[rgba(120,150,220,0.2)] dark:bg-[#111827]/95 dark:ring-1 dark:ring-[rgba(120,150,220,0.1)]"
    >
      <div className="flex items-center gap-4 sm:gap-6">
        <p className="shrink-0 text-[12px] font-semibold text-slate-400 dark:text-slate-400">System Health</p>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-1 sm:gap-2">
          {items.map((item) => {
            const healthy = item.status === 'healthy'
            const warning = item.status === 'warning'
            return (
              <div
                key={item.id}
                className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
                data-testid={`dashboard-system-health-${item.id}`}
              >
                <span className="text-[11px] font-medium text-slate-200">{item.label}</span>
                <SystemHealthStatusIcon status={item.status} />
                <span
                  className={cn(
                    'text-[11px] font-semibold',
                    healthy ? 'text-emerald-400' : warning ? 'text-amber-400' : 'text-red-400',
                  )}
                >
                  {systemHealthStatusLabel(item.status)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** @deprecated Use StreamsStatusDonut with operational status instead. */
export function StreamGroupHealthPanel({
  groupHealth,
}: {
  groupHealth: import('./dashboard-charter-metrics').StreamGroupHealthCounts
}) {
  const slices = donutSlicesFromCounts(groupHealth.healthy, groupHealth.warning, groupHealth.critical)
  return (
    <DonutPanel
      title="Stream group health"
      totalLabel="Groups"
      slices={slices}
      testId="dashboard-stream-group-health"
      footer={
        <Link to={NAV_PATH.streams} className="text-[11px] font-semibold text-violet-600 hover:underline dark:text-violet-300">
          View all streams →
        </Link>
      }
    />
  )
}

/** @deprecated Removed from main dashboard layout. */
export function TrafficOverviewPanel({
  traffic,
  series,
  loading,
}: {
  traffic: import('./dashboard-charter-metrics').TrafficOverviewMetrics
  series: TrafficChartPoint[]
  loading: boolean
}) {
  const rate = traffic.deliverySuccessRatePct ?? 0
  const empty = series.length === 0

  return (
    <section aria-label="Traffic overview" data-testid="dashboard-traffic-overview" className={cn(dashboardCardClass, loading && 'opacity-80')}>
      <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Traffic overview</h2>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">Window {traffic.windowLabel}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(
          [
            ['Incoming', formatMetricCount(traffic.incomingEvents), 'text-sky-400'],
            ['Outgoing', formatMetricCount(traffic.outgoingEvents), 'text-emerald-400'],
            ['Success', formatSuccessRate(traffic.deliverySuccessRatePct), rate >= 99 ? 'text-teal-400' : 'text-amber-300'],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="rounded-lg border border-slate-200/60 bg-slate-50/50 px-2 py-2 dark:border-gdc-border dark:bg-gdc-section/60">
            <p className="text-[10px] font-semibold uppercase text-slate-500 dark:text-gdc-muted">{label}</p>
            <p className={cn('mt-0.5 text-lg font-bold tabular-nums', color)}>{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 h-[160px] w-full">
        {empty && !loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500 dark:text-gdc-muted">No traffic trend data.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} width={32} />
              <Line type="monotone" dataKey="ingested" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="delivered" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

/** @deprecated Removed from main dashboard layout. */
export function OperationalIssuesPanel({
  issues,
}: {
  issues: import('./dashboard-charter-metrics').OperationalIssueCounts
}) {
  const rows = [
    { label: 'No data streams', count: issues.noDataStreams, testId: 'dashboard-issue-no-data', tone: 'sky' },
    { label: 'Low volume streams', count: issues.lowVolumeStreams, testId: 'dashboard-issue-low-volume', tone: 'amber' },
    { label: 'Schema drift', count: issues.schemaDriftCount, testId: 'dashboard-issue-schema-drift', tone: 'violet' },
    { label: 'Destination capacity', count: issues.destinationCapacityWarnings, testId: 'dashboard-issue-destination-capacity', tone: 'red' },
  ]
  const max = Math.max(1, ...rows.map((r) => r.count ?? 0))

  return (
    <section aria-label="Operational issues" data-testid="dashboard-operational-issues" className={dashboardCardClass}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Operational issues</h2>
        <Link to={NAV_PATH.streams} className="text-[11px] font-semibold text-violet-600 hover:underline dark:text-violet-300">
          Investigate in Streams →
        </Link>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const n = row.count ?? 0
          const pct = (100 * n) / max
          const hot = n > 0
          return (
            <li key={row.testId}>
              <Link to={NAV_PATH.streams} data-testid={row.testId} className="block rounded-lg border border-transparent p-1 transition hover:border-violet-500/30">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className={cn('font-medium', hot ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-gdc-muted')}>{row.label}</span>
                  <span className={cn('text-lg font-bold tabular-nums', hot ? 'text-red-400' : 'text-slate-500')}>{formatMetricCount(n)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className={cn('h-full rounded-full transition-all', hot ? 'bg-red-500/80' : 'bg-slate-500/40')}
                    style={{ width: `${Math.max(hot ? 8 : 0, pct)}%` }}
                  />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

