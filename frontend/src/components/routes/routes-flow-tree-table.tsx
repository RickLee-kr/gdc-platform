import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { routeEditPath, streamRuntimePath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import {
  buildRouteFlowTree,
  formatFlowEps,
  formatFlowErrorRate,
  formatFlowSuccessRate,
  routeHealthBadgeClass,
  routePublicId,
  type RouteFlowStreamGroup,
} from './routes-flow-helpers'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import type { RouteConsoleRow } from './routes-overview-helpers'

export type RoutesFlowTreeTableProps = {
  snapshot: OperationalSnapshotResponse | null
  consoleRows: readonly RouteConsoleRow[]
  loading?: boolean
}

export function RoutesFlowTreeTable({ snapshot, consoleRows, loading = false }: RoutesFlowTreeTableProps) {
  const groups = useMemo(() => buildRouteFlowTree(snapshot, consoleRows), [snapshot, consoleRows])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    setExpandedIds(new Set(groups.map((g) => g.streamId)))
  }, [groups])

  const allExpanded = groups.length > 0 && expandedIds.size >= groups.length

  function toggleStream(streamId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(streamId)) next.delete(streamId)
      else next.add(streamId)
      return next
    })
  }

  function toggleAll() {
    if (allExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(groups.map((g) => g.streamId)))
    }
  }

  return (
    <section
      aria-label="Route flow"
      className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-gdc-border">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Route Flow</h3>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            Stream → route → destination delivery at a glance
          </p>
        </div>
        {groups.length > 0 ? (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={cn(opTh, 'min-w-[200px]')}>Stream</th>
              <th className={cn(opTh, 'min-w-[180px]')}>Route / Destination</th>
              <th className={cn(opTh, 'min-w-[88px]')}>Throughput (EPS)</th>
              <th className={cn(opTh, 'min-w-[88px]')}>Success Rate</th>
              <th className={cn(opTh, 'min-w-[72px]')}>Error Rate</th>
              <th className={cn(opTh, 'min-w-[80px]')}>Health</th>
            </tr>
          </thead>
          <tbody>
            {loading && groups.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-slate-100/90 dark:border-gdc-divider">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-2.5 py-2">
                        <div className="h-2.5 animate-pulse rounded bg-slate-200/90 dark:bg-gdc-elevated" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && groups.length === 0 ? (
              <tr className={opTr}>
                <td className={cn(opTd, 'py-8 text-center text-[12px] text-slate-500')} colSpan={6}>
                  No routes configured yet.
                </td>
              </tr>
            ) : null}
            {groups.map((group) => (
              <StreamFlowRows
                key={group.streamId}
                group={group}
                expanded={expandedIds.has(group.streamId)}
                onToggle={() => toggleStream(group.streamId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StreamFlowRows({
  group,
  expanded,
  onToggle,
}: {
  group: RouteFlowStreamGroup
  expanded: boolean
  onToggle: () => void
}) {
  const routeCount = group.routes.length
  return (
    <Fragment>
      <tr className={cn(opTr, 'bg-slate-50/60 dark:bg-gdc-section/50')}>
        <td className={cn(opTd, 'font-semibold')}>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 text-left text-[12px] text-slate-900 hover:text-violet-700 dark:text-slate-100 dark:hover:text-violet-300"
          >
            {routeCount > 0 ? (
              expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <span className="inline-block w-3.5" />
            )}
            <Link
              to={streamRuntimePath(String(group.streamId))}
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {group.streamName}
            </Link>
          </button>
        </td>
        <td className={cn(opTd, 'text-[11px] text-slate-500 dark:text-gdc-muted')}>
          {routeCount} route{routeCount === 1 ? '' : 's'}
        </td>
        <td className={cn(opTd, 'tabular-nums text-[11px] font-semibold text-slate-900 dark:text-slate-50')}>
          {formatFlowEps(group.totalEps)}
        </td>
        <td className={opTd} colSpan={3} />
      </tr>
      {expanded
        ? group.routes.map((route, idx) => {
            const isLast = idx === group.routes.length - 1
            const prefix = isLast ? '└' : '├'
            return (
              <tr key={route.routeId} className={cn(opTr, !route.enabled && 'opacity-55')}>
                <td className={opTd} />
                <td className={cn(opTd, 'pl-4')}>
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-[11px] text-slate-400 dark:text-gdc-muted" aria-hidden>
                      {prefix}
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={routeEditPath(String(route.routeId))}
                        className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {route.routeLabel !== routePublicId(route.routeId) ? route.routeLabel : routePublicId(route.routeId)}
                      </Link>
                      <div className="truncate text-[11px] text-slate-600 dark:text-gdc-muted">{route.destinationName}</div>
                    </div>
                  </div>
                </td>
                <td className={cn(opTd, 'tabular-nums text-[11px] font-semibold')}>{formatFlowEps(route.eps)}</td>
                <td className={cn(opTd, 'tabular-nums text-[11px]')}>{formatFlowSuccessRate(route.successRatePct)}</td>
                <td className={cn(opTd, 'tabular-nums text-[11px]')}>{formatFlowErrorRate(route.errorRatePct)}</td>
                <td className={opTd}>
                  <span
                    className={cn(
                      'inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      routeHealthBadgeClass(route.health),
                    )}
                  >
                    {route.health}
                  </span>
                </td>
              </tr>
            )
          })
        : null}
    </Fragment>
  )
}
