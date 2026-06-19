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
import { StreamSharedProcessingSection } from './route-processing/stream-global-processing-section'
import { RouteProcessingInheritToggle } from './route-processing/route-processing-inherit-toggle'
import { RouteProcessingStatusLabel } from './route-processing/route-processing-status-badge'
import { ClassificationPanel } from './classification-panel'
import { ProtectionPanel } from './protection-panel'
import { PolicyPanel } from './policy-panel'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

type ProcessingStatus = 'Inherited' | 'Overridden' | 'Mixed'

type RouteProcessingStatuses = {
  transform: ProcessingStatus | null
  protection: ProcessingStatus | null
  classification: ProcessingStatus | null
  policy: ProcessingStatus | null
}

type DetailTab = 'transform' | 'protection' | 'classification' | 'policy' | 'delivery'

const DETAIL_TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'transform', label: 'Transform' },
  { key: 'protection', label: 'Protection' },
  { key: 'classification', label: 'Classification' },
  { key: 'policy', label: 'Policy' },
  { key: 'delivery', label: 'Delivery' },
]

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

function StreamRouteDetailTabs({
  streamId,
  route,
  tab,
  onTabChange,
}: {
  streamId: number
  route: RouteRead
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
}) {
  const [inheritTransform, setInheritTransform] = useState(true)
  const [inheritProtection, setInheritProtection] = useState(true)
  const [inheritClassification, setInheritClassification] = useState(true)
  const [inheritPolicy, setInheritPolicy] = useState(true)

  return (
    <section
      className="rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="route-processing-detail"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-gdc-border">
        <div>
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
            3 Route Details · {route.name?.trim() || `Route #${route.id}`}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Route ID {route.id}</p>
        </div>
        <Link
          to={routeEditPath(String(route.id))}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Full Route Edit
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-100 px-2 pt-2 dark:border-gdc-border" role="tablist">
        {DETAIL_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => onTabChange(item.key)}
            className={cn(
              '-mb-px border-b-2 px-2.5 pb-2 text-[11px] font-semibold',
              tab === item.key
                ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-gdc-muted',
            )}
            data-testid={`stream-route-detail-tab-${item.key}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 p-3">
        {tab === 'transform' ? (
          <div className="space-y-3" data-testid="route-processing-transform-section">
            <RouteProcessingInheritToggle
              checked={inheritTransform}
              onChange={setInheritTransform}
              concernLabel="Transform"
              data-testid="stream-route-inherit-transform"
            />
            <RouteEditTransformPanel routeId={route.id} streamId={streamId} />
          </div>
        ) : null}

        {tab === 'protection' ? (
          <div className="space-y-3" data-testid="route-processing-protection-section">
            <RouteProcessingInheritToggle
              checked={inheritProtection}
              onChange={setInheritProtection}
              concernLabel="Protection"
              data-testid="stream-route-inherit-protection"
            />
            <ProtectionPanel streamId={streamId} routeId={route.id} canOperate />
          </div>
        ) : null}

        {tab === 'classification' ? (
          <div className="space-y-3" data-testid="route-processing-classification-section">
            <RouteProcessingInheritToggle
              checked={inheritClassification}
              onChange={setInheritClassification}
              concernLabel="Classification"
              data-testid="stream-route-inherit-classification"
            />
            <ClassificationPanel streamId={streamId} routeId={route.id} canOperate />
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="space-y-3" data-testid="route-processing-policy-section">
            <RouteProcessingInheritToggle
              checked={inheritPolicy}
              onChange={setInheritPolicy}
              concernLabel="Policy"
              data-testid="stream-route-inherit-policy"
            />
            <PolicyPanel streamId={streamId} routeId={route.id} canOperate />
          </div>
        ) : null}

        {tab === 'delivery' ? (
          <div className="space-y-2" data-testid="route-processing-delivery-section">
            <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
              Delivery settings are route-specific — destination, failure policy, rate limits, and enable/disable.
            </p>
            <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-slate-600 dark:text-gdc-muted">Enabled</dt>
                <dd className="text-slate-900 dark:text-slate-100">{route.enabled ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-600 dark:text-gdc-muted">Failure policy</dt>
                <dd className="text-slate-900 dark:text-slate-100">{route.failure_policy ?? '—'}</dd>
              </div>
            </dl>
            <Link
              to={routeEditPath(String(route.id))}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              Edit delivery settings
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function StreamRouteProcessingOverview({ streamId }: { streamId: number }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [routes, setRoutes] = useState<RouteRead[]>([])
  const [destinations, setDestinations] = useState<DestinationListItem[]>([])
  const [statusByRoute, setStatusByRoute] = useState<Record<number, RouteProcessingStatuses>>({})
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('transform')

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
      className="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Route Processing Overview"
      data-testid="route-processing-overview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Route className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          Route Processing
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

      {error ? (
        <p className="text-[11px] text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <StreamSharedProcessingSection streamId={streamId} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="route-processing-split-layout">
        <div className="space-y-3" data-testid="route-processing-routes-section">
          <div>
            <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Route Processing</h4>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">
              Destination-specific processing units — select a route to review inherit/override status.
            </p>
          </div>
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
                  <th className={opTh}>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {loading && routes.length === 0 ? (
                  <tr className={opTr}>
                    <td className={cn(opTd, 'text-slate-500')} colSpan={8}>
                      Loading routes…
                    </td>
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
                          <RouteProcessingStatusLabel status={statuses?.transform ?? 'Inherited'} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingStatusLabel status={statuses?.protection ?? 'Inherited'} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingStatusLabel status={statuses?.classification ?? 'Inherited'} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingStatusLabel status={statuses?.policy ?? 'Inherited'} />
                        </td>
                        <td className={opTd}>
                          <span
                            className={cn(
                              'text-[11px] font-semibold',
                              route.enabled
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-slate-500 dark:text-gdc-muted',
                            )}
                          >
                            {route.enabled ? 'Enabled' : 'Disabled'}
                          </span>
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
          <StreamRouteDetailTabs
            streamId={streamId}
            route={selectedRoute}
            tab={detailTab}
            onTabChange={setDetailTab}
          />
        ) : (
          <section
            className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-slate-200/90 p-6 text-center dark:border-gdc-border"
            data-testid="route-processing-detail-empty"
          >
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Select a route to view processing details.</p>
          </section>
        )}
      </div>
    </section>
  )
}
