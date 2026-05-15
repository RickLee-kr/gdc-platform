import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Filter,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Route,
  Search,
  Server,
  SlidersHorizontal,
  Webhook,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { destinationDetailPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { StatusBadge, type StatusTone } from '../shell/status-badge'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import {
  CONNECTOR_FILTER_OPTIONS,
  DESTINATIONS_KPI,
  MOCK_DESTINATION_ROWS,
  STATUS_FILTER_OPTIONS,
  TYPE_FILTER_OPTIONS,
  destinationTypeLabel,
  type DestinationHealth,
  type DestinationKind,
  type MockDestinationRow,
} from './destinations-mock-data'

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
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{pct.toFixed(pct >= 100 ? 0 : pct <= 0 ? 0 : 2)}%</p>
      <div className="h-1 w-full max-w-[96px] overflow-hidden rounded-full bg-slate-200/90 dark:bg-gdc-elevated">
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

function enableTone(s: MockDestinationRow['enableStatus']): StatusTone {
  return s === 'ENABLED' ? 'success' : 'neutral'
}

function latencySparkClass(ms: number, enabled: boolean) {
  if (!enabled || ms <= 0) return 'text-slate-400 dark:text-gdc-muted'
  if (ms < 50) return 'text-violet-600 dark:text-violet-400'
  if (ms < 150) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function DestinationKindIcon({ kind }: { kind: DestinationKind }) {
  const syslogCls = 'border-violet-500/20 bg-violet-500/[0.09] text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-200'
  const hookCls = 'border-emerald-500/25 bg-emerald-500/[0.1] text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/12 dark:text-emerald-200'
  if (kind === 'WEBHOOK_POST') {
    return (
      <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', hookCls)}>
        <Webhook className="h-3.5 w-3.5" aria-hidden />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', syslogCls)}>
      <Server className="h-3.5 w-3.5" aria-hidden />
    </span>
  )
}

function HealthIndicator({ health }: { health: DestinationHealth }) {
  const dot =
    health === 'HEALTHY'
      ? 'bg-emerald-500'
      : health === 'DEGRADED'
        ? 'bg-amber-500'
        : 'bg-slate-400 dark:bg-slate-500'
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">{health}</span>
    </div>
  )
}

function matchesTypeFilter(filter: string, kind: DestinationKind): boolean {
  if (filter === 'All Types') return true
  return destinationTypeLabel(kind) === filter
}

export function DestinationsOverviewPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_FILTER_OPTIONS[0])
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_OPTIONS[0])
  const [connectorFilter, setConnectorFilter] = useState<string>(CONNECTOR_FILTER_OPTIONS[0])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const moreActionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!moreActionsRef.current?.contains(e.target as Node)) setMoreActionsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MOCK_DESTINATION_ROWS.filter((row) => {
      const hay = `${row.name} ${row.addressLine} ${row.connectorName}`.toLowerCase()
      if (q && !hay.includes(q)) return false
      if (!matchesTypeFilter(typeFilter, row.kind)) return false
      if (statusFilter !== 'All Statuses' && row.enableStatus !== statusFilter) return false
      if (connectorFilter !== 'All Connectors' && row.connectorName !== connectorFilter) return false
      return true
    })
  }, [search, typeFilter, statusFilter, connectorFilter])

  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, statusFilter, connectorFilter])

  const totalFiltered = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageOffset = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(pageOffset, pageOffset + pageSize)
  const showingFrom = totalFiltered === 0 ? 0 : pageOffset + 1
  const showingTo = totalFiltered === 0 ? 0 : Math.min(pageOffset + pageSize, totalFiltered)

  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage, page])

  const pageNumbers = useMemo(() => {
    const windowSize = 3
    const start = Math.max(1, Math.min(safePage - 1, totalPages - windowSize + 1))
    return Array.from({ length: Math.min(windowSize, totalPages) }, (_, i) => start + i).filter((n) => n <= totalPages)
  }, [safePage, totalPages])

  function clearFilters() {
    setSearch('')
    setTypeFilter(TYPE_FILTER_OPTIONS[0])
    setStatusFilter(STATUS_FILTER_OPTIONS[0])
    setConnectorFilter(CONNECTOR_FILTER_OPTIONS[0])
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Destinations</h2>
          <p className="max-w-xl text-[13px] text-slate-600 dark:text-gdc-muted">
            Manage output destinations for delivering processed events
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:hover:bg-gdc-rowHover"
            aria-label="Test all destinations (demo)"
          >
            <Activity className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            Test All
          </button>
          <div className="relative" ref={moreActionsRef}>
            <button
              type="button"
              onClick={() => setMoreActionsOpen((o) => !o)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:hover:bg-gdc-rowHover"
              aria-expanded={moreActionsOpen}
              aria-haspopup="menu"
            >
              More Actions
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            </button>
            {moreActionsOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-md border border-slate-200/90 bg-white py-1 text-[12px] shadow-lg dark:border-gdc-border dark:bg-gdc-card"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  onClick={() => setMoreActionsOpen(false)}
                >
                  Export destination list (demo)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                  onClick={() => setMoreActionsOpen(false)}
                >
                  Bulk enable / disable (demo)
                </button>
              </div>
            ) : null}
          </div>
          <Link
            to="/destinations"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New Destination
          </Link>
        </div>
      </div>

      <section aria-label="Destination KPI summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Total Destinations</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{DESTINATIONS_KPI.total}</p>
          <p className="mt-1 text-[11px] font-medium text-violet-700/90 dark:text-violet-300/90">{DESTINATIONS_KPI.totalSub}</p>
          <div className="mt-1.5 text-violet-600 dark:text-violet-400">
            <MiniSparkline values={[5, 6, 6, 7, 7, 8, 8]} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Enabled</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{DESTINATIONS_KPI.enabled}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{DESTINATIONS_KPI.enabledPct}</p>
          <ThinProgress pct={DESTINATIONS_KPI.enabledBarPct} toneClass="bg-emerald-500" />
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Healthy</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{DESTINATIONS_KPI.healthy}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-gdc-muted">{DESTINATIONS_KPI.healthyPct}</p>
          <ThinProgress pct={DESTINATIONS_KPI.healthyBarPct} toneClass="bg-emerald-500" />
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Failed (1h)</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {DESTINATIONS_KPI.failed1h.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] font-medium text-amber-800/90 dark:text-amber-300/90">{DESTINATIONS_KPI.failedTrend}</p>
          <div className="mt-1.5 text-amber-600 dark:text-amber-400">
            <MiniSparkline values={[96, 104, 110, 118, 122, 126, 128]} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Avg Latency (p95)</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">{DESTINATIONS_KPI.avgLatencyP95Ms} ms</p>
          <p className="mt-1 text-[11px] font-medium text-violet-800/90 dark:text-violet-300/90">{DESTINATIONS_KPI.latencyTrend}</p>
          <div className="mt-1.5 text-violet-600 dark:text-violet-400">
            <MiniSparkline values={[22, 23, 24, 25, 26, 27, 28]} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Throughput (1h)</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
            {DESTINATIONS_KPI.throughputPerMin.toLocaleString()} /min
          </p>
          <p className="mt-1 text-[11px] font-medium text-emerald-800/90 dark:text-emerald-300/90">{DESTINATIONS_KPI.throughputTrend}</p>
          <div className="mt-1.5 text-emerald-600 dark:text-emerald-400">
            <MiniSparkline values={[10800, 11050, 11320, 11680, 11940, 12190, 12458]} />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search destinations by name or address…"
              className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
              aria-label="Search destinations by name or address"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-1 lg:flex-wrap">
            <SelectField id="dest-filter-type" label="Destination type filter" value={typeFilter} options={TYPE_FILTER_OPTIONS} onChange={setTypeFilter} />
            <SelectField id="dest-filter-status" label="Status filter" value={statusFilter} options={STATUS_FILTER_OPTIONS} onChange={setStatusFilter} />
            <SelectField
              id="dest-filter-connector"
              label="Connector filter"
              value={connectorFilter}
              options={CONNECTOR_FILTER_OPTIONS}
              onChange={setConnectorFilter}
            />
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              More Filters
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200/70 pt-2 dark:border-gdc-border sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={clearFilters}
            className="self-start text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
          >
            Clear
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Filters
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="overflow-x-auto">
          <table className={opTable}>
            <thead>
              <tr className={opThRow}>
                <th scope="col" className={cn(opTh, 'min-w-[188px]')}>
                  Destination
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[96px]')}>
                  Type
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[200px]')}>
                  Address / Endpoint
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[120px]')}>
                  Connector
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[88px]')}>
                  Status
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Health
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Delivery (1h)
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[104px]')}>
                  Latency (p95)
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[112px]')}>
                  Throughput (1h)
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[100px]')}>
                  Last Test
                </th>
                <th scope="col" className={cn(opTh, 'min-w-[96px] text-right')}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr className={opTr}>
                  <td className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500')} colSpan={11}>
                    No destinations match the current filters.
                  </td>
                </tr>
              ) : null}
              {pageRows.map((row) => (
                <tr key={row.id} className={opTr}>
                  <td className={opTd}>
                    <div className="flex min-w-0 items-start gap-2">
                      <DestinationKindIcon kind={row.kind} />
                      <div className="min-w-0">
                        <Link
                          to={destinationDetailPath(row.id)}
                          className="text-[12px] font-semibold leading-snug text-violet-700 hover:underline dark:text-violet-300"
                        >
                          {row.name}
                        </Link>
                        <p className="mt-1">
                          <span className="inline-flex rounded-full border border-slate-200/90 bg-slate-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-muted">
                            {row.tag}
                          </span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className={opTd}>
                    <span className="text-[12px] font-medium text-slate-800 dark:text-slate-200">{destinationTypeLabel(row.kind)}</span>
                  </td>
                  <td className={opTd}>
                    <div className="max-w-[280px] min-w-0">
                      <p className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">{row.addressLine}</p>
                      <p className="mt-0.5 text-[10px] font-medium lowercase text-slate-500 dark:text-gdc-muted">{row.protocolHint}</p>
                    </div>
                  </td>
                  <td className={opTd}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium text-slate-800 dark:text-slate-200">{row.connectorName}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-gdc-muted">
                        <Route className="h-3 w-3 shrink-0" aria-hidden />
                        {row.routeCount} routes
                      </span>
                    </div>
                  </td>
                  <td className={opTd}>
                    <StatusBadge tone={enableTone(row.enableStatus)}>{row.enableStatus}</StatusBadge>
                  </td>
                  <td className={opTd}>
                    <HealthIndicator health={row.health} />
                  </td>
                  <td className={opTd}>
                    <DeliveryMeter pct={row.deliveryPct1h} />
                  </td>
                  <td className={opTd}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {row.enableStatus === 'DISABLED' || row.latencyP95Ms <= 0 ? '—' : `${row.latencyP95Ms} ms`}
                      </span>
                      <span className={latencySparkClass(row.latencyP95Ms, row.enableStatus === 'ENABLED')}>
                        <MiniSparkline values={row.latencySparkline} />
                      </span>
                    </div>
                  </td>
                  <td className={opTd}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {row.enableStatus === 'DISABLED' || row.throughputPerMin <= 0 ? '—' : `${row.throughputPerMin.toLocaleString()} /min`}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        <MiniSparkline values={row.throughputSparkline} />
                      </span>
                    </div>
                  </td>
                  <td className={opTd}>
                    <div className="flex items-center gap-1.5">
                      {row.lastTestOk ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Last test succeeded" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Last test failed or stale" />
                      )}
                      <span className="text-[11px] font-medium tabular-nums text-slate-700 dark:text-gdc-mutedStrong">{row.lastTestRelative}</span>
                    </div>
                  </td>
                  <td className={cn(opTd, 'text-right')}>
                    <div className="inline-flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                        aria-label={`Test destination ${row.name}`}
                        title="Test (demo)"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                        aria-label={`Edit destination ${row.name}`}
                        title="Edit (demo)"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                        aria-label={`More actions for ${row.name}`}
                        title="More (demo)"
                      >
                        <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular-nums">
            Showing {showingFrom} to {showingTo} of {totalFiltered} destinations
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
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-2 border-t border-slate-200/70 pt-2.5 text-[10px] leading-relaxed text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
        <Route className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        Demo dataset — live destination health and delivery counters will replace static rows when APIs are wired.
      </p>
    </div>
  )
}
