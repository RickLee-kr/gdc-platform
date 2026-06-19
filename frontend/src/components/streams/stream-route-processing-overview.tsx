import { ExternalLink, Loader2, RefreshCw, Route } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchDestinationsList, type DestinationListItem } from '../../api/gdcDestinations'
import { fetchRouteClassificationEffective } from '../../api/gdcRouteClassification'
import { fetchRoutePolicyEffective } from '../../api/gdcRoutePolicy'
import { fetchRouteProtectionEffective } from '../../api/gdcRouteProtection'
import { fetchRouteTransformEffective } from '../../api/gdcRouteTransform'
import { fetchRoutesList, type RouteRead } from '../../api/gdcRoutes'
import { routeEditPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { RouteEditTransformPanel } from '../routes/route-edit-transform-panel'
import { ClassificationPanel } from './classification-panel'
import { ProtectionPanel } from './protection-panel'
import { PolicyPanel } from './policy-panel'
import { StatusBadge, type StatusTone } from '../shell/status-badge'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

type ProcessingStatus = 'Inherited' | 'Overridden' | 'Mixed'

type RouteProcessingStatuses = {
  transform: ProcessingStatus | null
  protection: ProcessingStatus | null
  classification: ProcessingStatus | null
  policy: ProcessingStatus | null
}

function processingTone(status: ProcessingStatus | null): StatusTone {
  if (status === 'Overridden' || status === 'Mixed') return 'warning'
  if (status === 'Inherited') return 'neutral'
  return 'neutral'
}

function ProcessingStatusBadge({ status }: { status: ProcessingStatus | null }) {
  if (!status) return <span className="text-slate-400">—</span>
  return (
    <StatusBadge tone={processingTone(status)} data-testid={`route-processing-status-${status.toLowerCase()}`}>
      {status}
    </StatusBadge>
  )
}

async function fetchRouteProcessingStatuses(routeId: number): Promise<RouteProcessingStatuses> {
  const [transform, protection, classification, policy] = await Promise.all([
    fetchRouteTransformEffective(routeId),
    fetchRouteProtectionEffective(routeId),
    fetchRouteClassificationEffective(routeId),
    fetchRoutePolicyEffective(routeId),
  ])
  return {
    transform: transform?.processing_status ?? null,
    protection: protection?.processing_status ?? null,
    classification: classification?.processing_status ?? null,
    policy: policy?.processing_status ?? null,
  }
}

export function StreamRouteProcessingOverview({ streamId }: { streamId: number }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [routes, setRoutes] = useState<RouteRead[]>([])
  const [destinations, setDestinations] = useState<DestinationListItem[]>([])
  const [statusByRoute, setStatusByRoute] = useState<Record<number, RouteProcessingStatuses>>({})
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)

  const destinationById = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [allRoutes, dests] = await Promise.all([fetchRoutesList(), fetchDestinationsList()])
      const streamRoutes = (allRoutes ?? []).filter((r) => r.stream_id === streamId)
      setRoutes(streamRoutes)
      setDestinations(dests ?? [])
      const statuses: Record<number, RouteProcessingStatuses> = {}
      await Promise.all(
        streamRoutes.map(async (route) => {
          statuses[route.id] = await fetchRouteProcessingStatuses(route.id)
        }),
      )
      setStatusByRoute(statuses)
      setSelectedRouteId((prev) => {
        if (prev != null && streamRoutes.some((r) => r.id === prev)) return prev
        return streamRoutes[0]?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [streamId])

  useEffect(() => {
    void load()
  }, [load])

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null

  return (
    <section
      id="route-processing-section"
      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Route Processing Overview"
      data-testid="route-processing-overview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Route className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          Route Processing Overview
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted">
        Routes, transform, protection, classification, and policy for this stream — per-route overrides use the same panels as Route Edit.
      </p>

      {error ? (
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 space-y-3" data-testid="route-processing-routes-section">
        <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Routes</h4>
        <div className="overflow-x-auto">
          <table className={opTable} data-testid="route-processing-routes-table">
            <thead>
              <tr className={opThRow}>
                <th className={opTh}>Route</th>
                <th className={opTh}>Destination</th>
                <th className={opTh}>Enabled</th>
                <th className={opTh}>Transform</th>
                <th className={opTh}>Protection</th>
                <th className={opTh}>Classification</th>
                <th className={opTh}>Policy</th>
                <th className={opTh}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && routes.length === 0 ? (
                <tr className={opTr}>
                  <td className={cn(opTd, 'text-slate-500')} colSpan={8}>Loading routes…</td>
                </tr>
              ) : routes.length === 0 ? (
                <tr className={opTr}>
                  <td className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')} colSpan={8}>
                    No routes for this stream. Add routes in Delivery below.
                  </td>
                </tr>
              ) : (
                routes.map((route) => {
                  const dest = route.destination_id != null ? destinationById.get(route.destination_id) : undefined
                  const statuses = statusByRoute[route.id]
                  const isSelected = route.id === selectedRouteId
                  return (
                    <tr
                      key={route.id}
                      className={cn(opTr, isSelected && 'bg-violet-500/[0.04] dark:bg-violet-500/10')}
                      data-testid={`route-processing-row-${route.id}`}
                    >
                      <td className={opTd}>
                        <button
                          type="button"
                          onClick={() => setSelectedRouteId(route.id)}
                          className={cn(
                            'text-left text-[12px] font-semibold hover:text-violet-700 dark:hover:text-violet-300',
                            isSelected ? 'text-violet-700 dark:text-violet-300' : 'text-slate-900 dark:text-slate-100',
                          )}
                        >
                          {route.name?.trim() || `Route #${route.id}`}
                        </button>
                      </td>
                      <td className={opTd}>
                        {dest?.name?.trim() || (route.destination_id != null ? `Destination #${route.destination_id}` : '—')}
                      </td>
                      <td className={opTd}>{route.enabled ? 'Yes' : 'No'}</td>
                      <td className={opTd}>
                        <ProcessingStatusBadge status={statuses?.transform ?? null} />
                      </td>
                      <td className={opTd}>
                        <ProcessingStatusBadge status={statuses?.protection ?? null} />
                      </td>
                      <td className={opTd}>
                        <ProcessingStatusBadge status={statuses?.classification ?? null} />
                      </td>
                      <td className={opTd}>
                        <ProcessingStatusBadge status={statuses?.policy ?? null} />
                      </td>
                      <td className={opTd}>
                        <Link
                          to={routeEditPath(String(route.id))}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          Edit
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRoute != null ? (
        <div className="mt-4 space-y-3 border-t border-slate-200/80 pt-4 dark:border-gdc-border" data-testid="route-processing-detail">
          <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
            Route detail · {selectedRoute.name?.trim() || `Route #${selectedRoute.id}`}
          </p>
          <div className="space-y-3" data-testid="route-processing-transform-section">
            <RouteEditTransformPanel routeId={selectedRoute.id} streamId={streamId} />
          </div>
          <div data-testid="route-processing-protection-section">
            <ProtectionPanel streamId={streamId} routeId={selectedRoute.id} canOperate />
          </div>
          <div data-testid="route-processing-classification-section">
            <ClassificationPanel streamId={streamId} routeId={selectedRoute.id} canOperate />
          </div>
          <div data-testid="route-processing-policy-section">
            <PolicyPanel streamId={streamId} routeId={selectedRoute.id} canOperate />
          </div>
        </div>
      ) : null}
    </section>
  )
}
