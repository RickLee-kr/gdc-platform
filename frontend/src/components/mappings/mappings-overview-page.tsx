import { ChevronDown, Loader2, Play, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { streamMappingPath } from '../../config/nav-paths'
import { useMappingsOverviewData, type MappingOverviewRow } from '../../hooks/use-mappings-overview-data'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { StatusBadge, type StatusTone } from '../shell/status-badge'

const MAPPING_TYPE_FILTER_OPTIONS = ['All Types', 'MANUAL', 'AUTOMATIC'] as const
const MAPPING_STATUS_FILTER_OPTIONS = ['All Statuses', 'ENABLED', 'DISABLED'] as const

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
        className="h-8 w-full min-w-[7rem] appearance-none rounded-md border border-slate-200/90 bg-white py-1 pl-2 pr-7 text-[12px] font-medium text-slate-800 shadow-none focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
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

function enableTone(s: MappingOverviewRow['enableStatus']): StatusTone {
  return s === 'ENABLED' ? 'success' : 'neutral'
}

function mappingTypeBadgeClass(t: MappingOverviewRow['mappingType']): string {
  return t === 'AUTOMATIC'
    ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-950 dark:border-emerald-500/35 dark:bg-emerald-500/12 dark:text-emerald-100'
    : 'border-blue-500/25 bg-blue-500/[0.08] text-blue-900 dark:border-blue-500/35 dark:bg-blue-500/12 dark:text-blue-100'
}

export function MappingsOverviewPage() {
  const { rows: apiRows, kpi, connectorNames, streamLabels, apiBacked, loading, error, reload } =
    useMappingsOverviewData()
  const connectorFilterOptions = useMemo(() => ['All Connectors', ...connectorNames], [connectorNames])
  const streamFilterOptions = useMemo(() => ['All Streams', ...streamLabels], [streamLabels])

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>(MAPPING_TYPE_FILTER_OPTIONS[0])
  const [statusFilter, setStatusFilter] = useState<string>(MAPPING_STATUS_FILTER_OPTIONS[0])
  const [connectorFilter, setConnectorFilter] = useState('All Connectors')
  const [streamFilter, setStreamFilter] = useState('All Streams')
  const [page, setPage] = useState(1)
  const pageSize = 10

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return apiRows.filter((row) => {
      const hay = `${row.name} ${row.description} ${row.connectorName} ${row.streamLabel} ${row.sourceType}`.toLowerCase()
      if (q && !hay.includes(q)) return false
      if (typeFilter !== 'All Types' && row.mappingType !== typeFilter) return false
      if (statusFilter !== 'All Statuses' && row.enableStatus !== statusFilter) return false
      if (connectorFilter !== 'All Connectors' && row.connectorName !== connectorFilter) return false
      if (streamFilter !== 'All Streams' && row.streamLabel !== streamFilter) return false
      return true
    })
  }, [apiRows, search, typeFilter, statusFilter, connectorFilter, streamFilter])

  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, statusFilter, connectorFilter, streamFilter])

  const totalFiltered = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageOffset = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(pageOffset, pageOffset + pageSize)
  const enabledPct = kpi.total > 0 ? Math.round((100 * kpi.enabled) / kpi.total) : 0
  const withMappingPct = kpi.total > 0 ? Math.round((100 * kpi.withMapping) / kpi.total) : 0

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Mappings</h2>
          <p className="max-w-xl text-[13px] text-slate-600 dark:text-gdc-muted">
            One mapping workspace per stream — loaded from streams list and mapping-ui config APIs.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh
          </button>
          <Link
            to="/streams/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New stream
          </Link>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      ) : null}
      {!apiBacked && !loading ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          Streams API unavailable — mapping inventory cannot be loaded.
        </p>
      ) : null}

      <section aria-label="Mappings KPI summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Streams" value={loading ? '…' : String(kpi.total)} sub="Inventory rows" />
        <Kpi label="Enabled" value={loading ? '…' : String(kpi.enabled)} sub={`${enabledPct}% enabled`} />
        <Kpi label="With mapping" value={loading ? '…' : String(kpi.withMapping)} sub={`${withMappingPct}% configured`} />
        <Kpi label="Avg fields" value={loading ? '…' : String(kpi.avgFields)} sub="Per mapping-ui config" />
      </section>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by stream, connector, or description…"
              className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
            />
          </div>
          <SelectField id="map-type" label="Type" value={typeFilter} options={MAPPING_TYPE_FILTER_OPTIONS} onChange={setTypeFilter} />
          <SelectField id="map-status" label="Status" value={statusFilter} options={MAPPING_STATUS_FILTER_OPTIONS} onChange={setStatusFilter} />
          <SelectField id="map-conn" label="Connector" value={connectorFilter} options={connectorFilterOptions} onChange={setConnectorFilter} />
          <SelectField id="map-stream" label="Stream" value={streamFilter} options={streamFilterOptions} onChange={setStreamFilter} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-[13px] text-slate-600 dark:text-gdc-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading mapping inventory…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh}>Stream / mapping</th>
                  <th className={opTh}>Type</th>
                  <th className={opTh}>Connector</th>
                  <th className={opTh}>Source</th>
                  <th className={opTh}>Fields</th>
                  <th className={opTh}>Status</th>
                  <th className={cn(opTh, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr className={opTr}>
                    <td colSpan={7} className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500')}>
                      No streams match the current filters.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr key={row.id} className={opTr}>
                      <td className={opTd}>
                        <Link to={streamMappingPath(row.streamId)} className="text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                          {row.name}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{row.description}</p>
                      </td>
                      <td className={opTd}>
                        <span className={cn('inline-flex rounded border px-1.5 py-px text-[10px] font-bold uppercase', mappingTypeBadgeClass(row.mappingType))}>
                          {row.mappingType}
                        </span>
                      </td>
                      <td className={opTd}>{row.connectorName}</td>
                      <td className={opTd}>{row.sourceType}</td>
                      <td className={cn(opTd, 'tabular-nums font-semibold')}>{row.fieldCount}</td>
                      <td className={opTd}>
                        <StatusBadge tone={enableTone(row.enableStatus)}>{row.enableStatus}</StatusBadge>
                      </td>
                      <td className={cn(opTd, 'text-right')}>
                        <Link
                          to={streamMappingPath(row.streamId)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
                          title="Open mapping workspace"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-200/80 px-3 py-2 text-[11px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
          Showing {totalFiltered === 0 ? 0 : pageOffset + 1}–{Math.min(pageOffset + pageSize, totalFiltered)} of {totalFiltered}
          {' · '}
          <button type="button" className="font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
            Prev
          </button>
          {' · '}
          <button type="button" className="font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
            Next
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-[10px] text-slate-500 dark:text-gdc-muted">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Field mappings are stored per stream. Open a stream mapping workspace to edit JSONPath rules; runtime applies mapping before enrichment.
      </p>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white/90 px-3 py-2 dark:border-gdc-border/90 dark:bg-gdc-card">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">{sub}</p>
    </div>
  )
}
