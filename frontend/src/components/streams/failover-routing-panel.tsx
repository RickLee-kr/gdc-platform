import { Shield, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchStreamFailoverRoutes,
  fetchStreamFailoverRoutingSummary,
  type FailoverRoute,
  type StreamFailoverRoutingSummaryResponse,
} from '../../api/gdcFailoverRouting'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

export function FailoverRoutingPanel({ streamId }: { streamId: number }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamFailoverRoutingSummaryResponse | null>(null)
  const [routes, setRoutes] = useState<FailoverRoute[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, r] = await Promise.all([
        fetchStreamFailoverRoutingSummary(streamId),
        fetchStreamFailoverRoutes(streamId),
      ])
      setSummary(s)
      setRoutes(r?.routes ?? [])
      if (s == null && r == null) {
        setError('Failover routing APIs unavailable.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [streamId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Failover Routing"
      data-testid="failover-routing-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          Failover Routing
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
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Failover metrics</p>
      <dl className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4" data-testid="failover-routing-metrics">
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Total routes</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.total_failover_routes ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Attempts</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.failover_attempts ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Successes</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.failover_successes ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Failures</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.failover_failures ?? '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 overflow-x-auto" data-testid="failover-routing-rules-table">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Primary</th>
              <th className={opTh}>Secondary</th>
              <th className={opTh}>Policy</th>
              <th className={opTh}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 ? (
              <tr className={opTr}>
                <td className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')} colSpan={4}>
                  {loading ? 'Loading…' : 'No failover routes.'}
                </td>
              </tr>
            ) : (
              routes.map((rule) => (
                <tr key={rule.id} className={opTr} data-testid={`failover-route-row-${rule.id}`}>
                  <td className={opTd}>{rule.primary_destination_name ?? rule.primary_destination_id}</td>
                  <td className={opTd}>{rule.secondary_destination_name ?? rule.secondary_destination_id}</td>
                  <td className={opTd}>{rule.policy}</td>
                  <td className={opTd}>{rule.enabled ? 'Yes' : 'No'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
