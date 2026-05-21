import {
  ArrowRight,
  Cable,
  ExternalLink,
  GitBranch,
  Layers,
  Map as MapIcon,
  RefreshCw,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRuntimeTopology } from '../../api/gdcRuntimeTopology'
import type {
  HealthLevel,
  RuntimeTopologyResponse,
  TopologyRouteNode,
  TopologyStreamNode,
} from '../../api/types/gdcApi'
import {
  connectorDetailPath,
  destinationDetailPath,
  logsExplorerPath,
  runtimeAnalyticsPath,
  streamEnrichmentPath,
  streamMappingPath,
  streamRuntimePath,
} from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { StatusBadge, type StatusTone } from '../shell/status-badge'
import { HealthBadge } from './operational-health/health-badge'

const WINDOW_OPTIONS = ['15m', '1h', '6h', '24h'] as const
type WindowToken = (typeof WINDOW_OPTIONS)[number]

function enabledTone(enabled: boolean): StatusTone {
  return enabled ? 'success' : 'neutral'
}

function streamStatusTone(status: string): StatusTone {
  const s = status.toUpperCase()
  if (s === 'RUNNING') return 'success'
  if (s === 'ERROR' || s === 'FAILED') return 'error'
  if (s === 'PAUSED' || s === 'STOPPED') return 'warning'
  return 'neutral'
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function PipelineArrow() {
  return (
    <ArrowRight
      className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block dark:text-gdc-muted"
      aria-hidden
    />
  )
}

function StageChip({
  label,
  present,
  enabled,
  href,
}: {
  label: string
  present: boolean
  enabled?: boolean
  href?: string
}) {
  const inner = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium',
        present
          ? 'border-sky-500/20 bg-sky-500/[0.06] text-sky-950 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100'
          : 'border-dashed border-slate-300/60 text-slate-500 dark:border-gdc-borderStrong/50 dark:text-gdc-muted',
      )}
    >
      {label}
      {present ? (
        <StatusBadge tone={enabled === false ? 'warning' : 'success'} className="ml-0.5">
          {enabled === false ? 'Off' : 'On'}
        </StatusBadge>
      ) : (
        <span className="text-[10px] uppercase tracking-wide opacity-70">Missing</span>
      )}
    </span>
  )
  if (href && present) {
    return (
      <Link to={href} className="rounded-lg outline-none ring-offset-2 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-sky-500/40">
        {inner}
      </Link>
    )
  }
  return inner
}

function HealthOrIdle({
  level,
  score,
}: {
  level: HealthLevel | null
  score: number | null
}) {
  if (level == null || score == null) {
    return <StatusBadge tone="neutral">Idle</StatusBadge>
  }
  return <HealthBadge level={level} score={score} compact />
}

function RouteDestinationCard({ route }: { route: TopologyRouteNode }) {
  const inactive = !route.enabled || !route.destination_enabled
  return (
    <div
      className={cn(
        'min-w-[200px] flex-1 rounded-xl border p-3 shadow-sm',
        inactive
          ? 'border-slate-200/80 bg-slate-50/80 opacity-90 dark:border-gdc-border dark:bg-gdc-elevated/40'
          : 'border-slate-200/90 bg-white dark:border-gdc-border dark:bg-gdc-card',
      )}
      data-route-id={route.route_id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Route</p>
          <p className="font-mono text-xs text-slate-700 dark:text-slate-200">#{route.route_id}</p>
        </div>
        <HealthOrIdle level={route.health_level} score={route.health_score} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <StatusBadge tone={enabledTone(route.enabled)}>{route.enabled ? 'Route on' : 'Route off'}</StatusBadge>
        <StatusBadge tone={enabledTone(route.destination_enabled)}>
          {route.destination_enabled ? 'Dest on' : 'Dest off'}
        </StatusBadge>
      </div>
      <div className="mt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Destination</p>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
          {route.destination_name ?? `Destination #${route.destination_id}`}
        </p>
        <p className="font-mono text-[11px] text-slate-500 dark:text-gdc-muted">{route.destination_type ?? '—'}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <Link
          to={destinationDetailPath(String(route.destination_id))}
          className="inline-flex items-center gap-0.5 text-sky-700 hover:underline dark:text-sky-300"
        >
          Open destination <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
        <Link
          to={logsExplorerPath({ stream_id: route.stream_id, route_id: route.route_id })}
          className="inline-flex items-center gap-0.5 text-sky-700 hover:underline dark:text-sky-300"
        >
          Route logs <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
        <Link
          to={runtimeAnalyticsPath({ route_id: route.route_id, window: '24h' })}
          className="inline-flex items-center gap-0.5 text-slate-600 hover:underline dark:text-gdc-muted"
        >
          Analytics
        </Link>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500 dark:text-gdc-muted">
        Last success {formatTs(route.last_success_at)} · Last failure {formatTs(route.last_failure_at)}
      </p>
    </div>
  )
}

function StreamPipelineCard({
  stream,
  routes,
}: {
  stream: TopologyStreamNode
  routes: TopologyRouteNode[]
}) {
  const streamRoutes = routes.filter((r) => r.stream_id === stream.stream_id)
  return (
    <article
      className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-stream-id={stream.stream_id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Stream</p>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{stream.stream_name}</h3>
          <p className="font-mono text-[11px] text-slate-500 dark:text-gdc-muted">
            #{stream.stream_id} · {stream.stream_type || 'stream'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={enabledTone(stream.enabled)}>{stream.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
          <StatusBadge tone={streamStatusTone(stream.status)}>{stream.status}</StatusBadge>
          <HealthOrIdle level={stream.health_level} score={stream.health_score} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <StageChip label="Mapping" present={stream.has_mapping} href={streamMappingPath(String(stream.stream_id))} />
        <PipelineArrow />
        <StageChip
          label="Enrichment"
          present={stream.has_enrichment}
          enabled={stream.enrichment_enabled}
          href={streamEnrichmentPath(String(stream.stream_id))}
        />
        <PipelineArrow />
        <span className="inline-flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-2 py-1 text-[11px] font-medium text-violet-950 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-100">
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
          Routes ({streamRoutes.length})
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Link
          to={streamRuntimePath(String(stream.stream_id))}
          className="inline-flex items-center gap-0.5 font-medium text-sky-700 hover:underline dark:text-sky-300"
        >
          Stream runtime <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
        <Link
          to={logsExplorerPath({ stream_id: stream.stream_id })}
          className="inline-flex items-center gap-0.5 text-sky-700 hover:underline dark:text-sky-300"
        >
          Stream logs <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {streamRoutes.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          {streamRoutes.map((route) => (
            <RouteDestinationCard key={route.route_id} route={route} />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300/70 px-3 py-2 text-sm text-slate-500 dark:border-gdc-borderStrong/50 dark:text-gdc-muted">
          No routes configured for this stream.
        </p>
      )}
    </article>
  )
}

export function RuntimeTopologyPage() {
  const [windowToken, setWindowToken] = useState<WindowToken>('24h')
  const [topology, setTopology] = useState<RuntimeTopologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await fetchRuntimeTopology({ window: windowToken, scoring_mode: 'current_runtime' })
      if (body == null) {
        setError('Could not load runtime topology (API unavailable or unauthorized).')
        return
      }
      setTopology(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [windowToken])

  useEffect(() => {
    void load()
  }, [load])

  const graph = useMemo(() => {
    if (!topology) return []
    const sourcesByConnector = new Map<number, typeof topology.sources>()
    for (const source of topology.sources) {
      const list = sourcesByConnector.get(source.connector_id) ?? []
      list.push(source)
      sourcesByConnector.set(source.connector_id, list)
    }
    const streamsBySource = new Map<number, TopologyStreamNode[]>()
    for (const stream of topology.streams) {
      const list = streamsBySource.get(stream.source_id) ?? []
      list.push(stream)
      streamsBySource.set(stream.source_id, list)
    }
    return topology.connectors.map((connector) => ({
      connector,
      sources: (sourcesByConnector.get(connector.id) ?? []).map((source) => ({
        source,
        streams: streamsBySource.get(source.id) ?? [],
      })),
    }))
  }, [topology])

  const empty = topology != null && topology.summary.stream_count === 0

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Operations</p>
          <h1 className="mt-0.5 flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
            <Layers className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            Runtime topology
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-gdc-muted">
            Configured pipeline graph: Source → Stream → Mapping → Enrichment → Route fan-out → Destination. Health
            badges use live runtime posture for the selected window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-gdc-muted">
            Window
            <select
              value={windowToken}
              onChange={(e) => setWindowToken(e.target.value as WindowToken)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-gdc-border dark:bg-gdc-input"
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh
          </button>
          <Link
            to="/runtime"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          >
            Runtime overview
          </Link>
        </div>
      </header>

      {topology ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              { label: 'Connectors', value: topology.summary.connector_count, Icon: Cable },
              { label: 'Sources', value: topology.summary.source_count, Icon: Workflow },
              { label: 'Streams', value: topology.summary.stream_count, Icon: Sparkles },
              { label: 'Routes', value: topology.summary.route_count, Icon: GitBranch },
              { label: 'Destinations', value: topology.summary.destination_count, Icon: MapIcon },
              { label: 'Mapped', value: topology.summary.streams_with_mapping, Icon: MapIcon },
              { label: 'Enriched', value: topology.summary.streams_with_enrichment, Icon: Sparkles },
              { label: 'Routes off', value: topology.summary.disabled_routes, Icon: GitBranch },
            ] as const
          ).map(({ label, value, Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
            >
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                <Icon className="h-3 w-3" aria-hidden />
                {label}
              </p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-900 dark:text-rose-100">
          {error}
        </p>
      ) : null}

      {loading && !topology ? (
        <p className="text-sm text-slate-500 dark:text-gdc-muted">Loading topology…</p>
      ) : null}

      {empty ? (
        <section className="rounded-xl border border-dashed border-slate-300/70 bg-white p-8 text-center shadow-sm dark:border-gdc-borderStrong/50 dark:bg-gdc-card">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">No configured pipelines yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-gdc-muted">
            Create a connector, source, stream, and at least one route to see the runtime graph.
          </p>
          <Link
            to="/connectors"
            className="mt-4 inline-flex rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            Go to connectors
          </Link>
        </section>
      ) : null}

      {!empty && graph.length > 0 ? (
        <div className="space-y-6">
          {graph.map(({ connector, sources }) => (
            <section
              key={connector.id}
              className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 dark:border-gdc-border dark:bg-gdc-elevated/30"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Connector</p>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{connector.name}</h2>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-gdc-muted">
                    #{connector.id} · {connector.source_count} source(s) · {connector.stream_count} stream(s)
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge tone={streamStatusTone(connector.status)}>{connector.status}</StatusBadge>
                  <Link
                    to={connectorDetailPath(String(connector.id))}
                    className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-sky-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-sky-300"
                  >
                    Connector detail <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              </div>

              {sources.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-gdc-muted">No sources on this connector.</p>
              ) : (
                <div className="space-y-5">
                  {sources.map(({ source, streams }) => (
                    <div key={source.id} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-2 dark:border-gdc-border dark:bg-gdc-card">
                        <PipelineArrow />
                        <div className="flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Source</p>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                            {source.source_type} <span className="font-mono text-slate-500">#{source.id}</span>
                          </p>
                        </div>
                        <StatusBadge tone={enabledTone(source.enabled)}>{source.enabled ? 'Source on' : 'Source off'}</StatusBadge>
                        <span className="text-[11px] text-slate-500 dark:text-gdc-muted">{streams.length} stream(s)</span>
                      </div>

                      {streams.length === 0 ? (
                        <p className="ml-6 text-sm text-slate-500 dark:text-gdc-muted">No streams for this source.</p>
                      ) : (
                        <div className="ml-0 space-y-4 sm:ml-4">
                          {streams.map((stream) => (
                            <StreamPipelineCard
                              key={stream.stream_id}
                              stream={stream}
                              routes={topology?.routes ?? []}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
