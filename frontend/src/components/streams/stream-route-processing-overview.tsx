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
import { RouteProcessingDetailHeader } from './route-processing/route-processing-detail-header'
import {
  RouteProcessingDeliveryBadge,
  RouteProcessingStatusBadge,
} from './route-processing/route-processing-status-badge'
import { ROUTE_PROCESSING_COPY } from './route-processing/route-processing-labels'
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

async function fetchConcernProcessingStatus(
  fetcher: () => Promise<{ processing_status?: ProcessingStatus } | null>,
): Promise<ProcessingStatus | null> {
  try {
    const result = await fetcher()
    return result?.processing_status ?? null
  } catch {
    return null
  }
}

async function fetchRouteProcessingStatuses(routeId: number): Promise<RouteProcessingStatuses> {
  const [transform, protection, classification, policy] = await Promise.all([
    fetchConcernProcessingStatus(() => fetchRouteTransformEffective(routeId)),
    fetchConcernProcessingStatus(() => fetchRouteProtectionEffective(routeId)),
    fetchConcernProcessingStatus(() => fetchRouteClassificationEffective(routeId)),
    fetchConcernProcessingStatus(() => fetchRoutePolicyEffective(routeId)),
  ])
  return { transform, protection, classification, policy }
}

function RouteProcessingTableStatusCell({
  status,
  pending,
}: {
  status: ProcessingStatus | null | undefined
  pending: boolean
}) {
  if (pending) {
    return (
      <span className="text-[10px] text-slate-400 dark:text-gdc-muted" data-testid="route-processing-status-pending">
        …
      </span>
    )
  }
  if (status == null) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-slate-200/90 bg-slate-100/80 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted"
        data-testid="route-processing-status-unavailable"
      >
        Unavailable
      </span>
    )
  }
  return <RouteProcessingStatusBadge status={status} />
}

function StreamRouteDetailTabs({
  streamId,
  route,
  destinationLabel,
  destinationMissing,
  tab,
  onTabChange,
  processingStatuses,
  statusesPending,
}: {
  streamId: number
  route: RouteRead
  destinationLabel: string | null
  destinationMissing: boolean
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
  processingStatuses: RouteProcessingStatuses | undefined
  statusesPending: boolean
}) {
  const routeEditHref = routeEditPath(String(route.id))

  return (
    <section
      className="rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="route-processing-detail"
    >
      <RouteProcessingDetailHeader
        routeLabel={route.name?.trim() || `Route #${route.id}`}
        destinationLabel={destinationLabel}
        destinationMissing={destinationMissing}
        actions={
          <Link
            to={routeEditHref}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            data-testid="stream-route-open-route-edit"
          >
            Open Route Edit
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        }
      />

      <p className="border-b border-slate-100 px-3 pb-2 text-[10px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
        Inherit status reflects runtime effective config (read-only). To change inherit or override, use{' '}
        <Link
          to={routeEditHref}
          className="font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Route Edit
        </Link>
        .
      </p>

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
              readonly
              checked={false}
              onChange={() => {}}
              concernLabel="Transform"
              processingStatus={processingStatuses?.transform ?? null}
              statusPending={statusesPending}
              data-testid="stream-route-inherit-transform"
            />
            <RouteEditTransformPanel routeId={route.id} streamId={streamId} />
          </div>
        ) : null}

        {tab === 'protection' ? (
          <div className="space-y-3" data-testid="route-processing-protection-section">
            <RouteProcessingInheritToggle
              readonly
              checked={false}
              onChange={() => {}}
              concernLabel="Protection"
              processingStatus={processingStatuses?.protection ?? null}
              statusPending={statusesPending}
              data-testid="stream-route-inherit-protection"
            />
            <ProtectionPanel streamId={streamId} routeId={route.id} canOperate />
          </div>
        ) : null}

        {tab === 'classification' ? (
          <div className="space-y-3" data-testid="route-processing-classification-section">
            <RouteProcessingInheritToggle
              readonly
              checked={false}
              onChange={() => {}}
              concernLabel="Classification"
              processingStatus={processingStatuses?.classification ?? null}
              statusPending={statusesPending}
              data-testid="stream-route-inherit-classification"
            />
            <ClassificationPanel streamId={streamId} routeId={route.id} canOperate />
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="space-y-3" data-testid="route-processing-policy-section">
            <RouteProcessingInheritToggle
              readonly
              checked={false}
              onChange={() => {}}
              concernLabel="Policy"
              processingStatus={processingStatuses?.policy ?? null}
              statusPending={statusesPending}
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
  const [statusesLoading, setStatusesLoading] = useState(true)
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('transform')

  const destinationById = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations])

  const load = useCallback(async () => {
    setLoading(true)
    setStatusesLoading(true)
    setError(null)
    try {
      const [allRoutes, dests] = await Promise.all([fetchRoutesList(), fetchDestinationsList()])
      const streamRoutes = (allRoutes ?? []).filter((r) => r.stream_id === streamId)
      setRoutes(streamRoutes)
      setDestinations(dests ?? [])
      setSelectedRouteId((prev) => {
        if (prev != null && streamRoutes.some((r) => r.id === prev)) return prev
        return streamRoutes[0]?.id ?? null
      })
      const statuses: Record<number, RouteProcessingStatuses> = {}
      await Promise.all(
        streamRoutes.map(async (route) => {
          statuses[route.id] = await fetchRouteProcessingStatuses(route.id)
        }),
      )
      setStatusByRoute(statuses)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatusByRoute({})
    } finally {
      setLoading(false)
      setStatusesLoading(false)
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
                    <td className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')} colSpan={8} data-testid="route-processing-empty">
                      <p className="font-semibold">{ROUTE_PROCESSING_COPY.noRoutes}</p>
                      <p className="mt-0.5 text-[11px]">{ROUTE_PROCESSING_COPY.noRoutesHint}</p>
                    </td>
                  </tr>
                ) : (
                  routes.map((route) => {
                    const dest = route.destination_id != null ? destinationById.get(route.destination_id) : undefined
                    const destLabel = dest?.name?.trim() || (route.destination_id != null ? `Destination #${route.destination_id}` : null)
                    const destinationMissing = route.destination_id == null || !dest
                    const statuses = statusByRoute[route.id]
                    const statusPending = statusesLoading && statuses === undefined
                    const isSelected = route.id === selectedRouteId
                    return (
                      <tr
                        key={route.id}
                        className={cn(
                          opTr,
                          isSelected &&
                            'bg-violet-500/[0.06] shadow-[inset_3px_0_0_0] shadow-violet-500 dark:bg-violet-500/10 dark:shadow-violet-400',
                        )}
                        data-testid={`route-processing-row-${route.id}`}
                        aria-current={isSelected ? 'true' : undefined}
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
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              {route.name?.trim() || `Route #${route.id}`}
                              {isSelected ? (
                                <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white dark:bg-violet-500">
                                  Active
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </td>
                        <td className={opTd}>
                          {destinationMissing ? (
                            <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                              {ROUTE_PROCESSING_COPY.destinationMissing}
                            </span>
                          ) : (
                            destLabel
                          )}
                        </td>
                        <td className={opTd}>
                          <RouteProcessingDeliveryBadge enabled={Boolean(route.enabled)} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingTableStatusCell status={statuses?.transform} pending={statusPending} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingTableStatusCell status={statuses?.protection} pending={statusPending} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingTableStatusCell status={statuses?.classification} pending={statusPending} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingTableStatusCell status={statuses?.policy} pending={statusPending} />
                        </td>
                        <td className={opTd}>
                          <RouteProcessingDeliveryBadge enabled={Boolean(route.enabled)} />
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
            destinationLabel={
              selectedRoute.destination_id != null
                ? destinationById.get(selectedRoute.destination_id)?.name?.trim() ??
                  `Destination #${selectedRoute.destination_id}`
                : null
            }
            destinationMissing={
              selectedRoute.destination_id == null ||
              !destinationById.get(selectedRoute.destination_id)
            }
            tab={detailTab}
            onTabChange={setDetailTab}
            processingStatuses={selectedRouteId != null ? statusByRoute[selectedRouteId] : undefined}
            statusesPending={statusesLoading && selectedRouteId != null && statusByRoute[selectedRouteId] === undefined}
          />
        ) : (
          <section
            className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-slate-200/90 p-6 text-center dark:border-gdc-border"
            data-testid="route-processing-detail-empty"
          >
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">{ROUTE_PROCESSING_COPY.selectRouteDetail}</p>
          </section>
        )}
      </div>
    </section>
  )
}
