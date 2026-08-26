import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchConnectorApiHealth,
  type ConnectorApiHealthResponse,
  type ConnectorApiHealthStatus,
} from '../../api/gdcConnectorApiHealth'
import { streamRuntimePath } from '../../config/nav-paths'
import { formatRelativeShort } from '../../lib/stream-console-metrics'
import { cn } from '../../lib/utils'

function healthTone(health: ConnectorApiHealthStatus): string {
  switch (health) {
    case 'UNHEALTHY':
      return 'border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/30'
    case 'WARNING':
      return 'border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20'
    case 'HEALTHY':
      return 'border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
    default:
      return 'border-slate-200 bg-slate-50/80 dark:border-gdc-border dark:bg-gdc-section'
  }
}

function HealthIcon({ health }: { health: ConnectorApiHealthStatus }) {
  if (health === 'UNHEALTHY' || health === 'WARNING') {
    return (
      <AlertTriangle
        className={cn('h-3.5 w-3.5 shrink-0', health === 'UNHEALTHY' ? 'text-red-500' : 'text-amber-500')}
        aria-hidden
      />
    )
  }
  if (health === 'HEALTHY') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
  }
  return <Activity className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
}

type Props = {
  connectorId: number
}

export function ConnectorApiHealthPanel({ connectorId }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ConnectorApiHealthResponse | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!mountedRef.current) return
    setLoading(true)
    setError(null)
    try {
      const body = await fetchConnectorApiHealth(connectorId)
      if (!mountedRef.current) return
      setData(body)
    } catch (e: unknown) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load connector API health')
      setData(null)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [connectorId])

  useEffect(() => {
    void load()
  }, [load])

  const troubleshootStreamId = data?.affected_streams[0]?.stream_id
  const troubleshootHref =
    troubleshootStreamId != null ? `${streamRuntimePath(String(troubleshootStreamId))}#data-flow-troubleshooter` : null

  return (
    <section
      aria-label="Connector API Health"
      data-testid="connector-api-health-panel"
      className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-border">
        <div className="flex items-start gap-2">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div>
            <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Connector / API Health</h3>
            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
              Connection, auth, and source API posture from existing runtime evidence
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="connector-api-health-refresh"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-section"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <div
          className="flex items-center gap-2 px-4 py-8 text-[12px] text-slate-500"
          role="status"
          data-testid="connector-api-health-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading connector API health…
        </div>
      ) : null}

      {error ? (
        <div className="px-4 py-4 text-[12px] text-red-600 dark:text-red-300" data-testid="connector-api-health-error" role="alert">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-4 p-4 lg:grid-cols-12" data-testid="connector-api-health-body">
          <div className={cn('space-y-3 rounded-lg border px-3 py-2 lg:col-span-7', healthTone(data.health))}>
            <p
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted"
              data-testid="connector-api-health-status"
            >
              <HealthIcon health={data.health} />
              Status · {data.health}
            </p>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Problem</dt>
                <dd className="font-semibold text-slate-900 dark:text-slate-100" data-testid="connector-api-health-problem">
                  {data.problem}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Cause</dt>
                <dd data-testid="connector-api-health-cause">{data.cause}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Action</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-100" data-testid="connector-api-health-action">
                  {data.recommended_action}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Last success</dt>
                <dd data-testid="connector-api-health-last-success">
                  {data.last_success_at ? formatRelativeShort(data.last_success_at) : '—'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Last failure</dt>
                <dd data-testid="connector-api-health-last-failure">
                  {data.last_failure_at ? formatRelativeShort(data.last_failure_at) : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-3 lg:col-span-5">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Operator actions
              </p>
              <ul className="flex flex-wrap gap-2" data-testid="connector-api-health-actions">
                {data.actions.map((action) => {
                  if (action.id === 'open_troubleshooter' && troubleshootHref) {
                    return (
                      <li key={action.id}>
                        <Link
                          to={troubleshootHref}
                          className="inline-flex rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200"
                        >
                          {action.label}
                        </Link>
                      </li>
                    )
                  }
                  return (
                    <li key={action.id}>
                      <span className="inline-flex rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-gdc-border dark:text-slate-300">
                        {action.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {data.affected_streams.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Affected streams
                </p>
                <ul className="space-y-1" data-testid="connector-api-health-streams">
                  {data.affected_streams.map((stream) => (
                    <li key={stream.stream_id}>
                      <Link
                        to={`${streamRuntimePath(String(stream.stream_id))}#data-flow-troubleshooter`}
                        className="text-[12px] font-medium text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {stream.stream_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.evidence.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  Evidence
                </p>
                <ul className="space-y-2" data-testid="connector-api-health-evidence">
                  {data.evidence.map((ev, idx) => (
                    <li
                      key={`${ev.kind}-${ev.id}-${idx}`}
                      className="rounded-md border border-slate-200/80 bg-slate-50/80 px-2.5 py-2 text-[11px] dark:border-gdc-border dark:bg-gdc-section"
                    >
                      <p className="font-semibold text-slate-800 dark:text-slate-100">
                        {ev.kind}
                        {ev.error_code ? ` · ${ev.error_code}` : ''}
                        {ev.http_status != null ? ` · HTTP ${ev.http_status}` : ''}
                      </p>
                      <p className="mt-0.5 break-words text-slate-600 dark:text-gdc-muted">{ev.message || ev.stage}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
