import { Bot, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchAiGatewaySummary,
  type AiGatewayPolicyEntry,
  type AiGatewayRequestEntry,
  type AiGatewaySummaryResponse,
} from '../../api/gdcAiGateway'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

function DecisionBadge({ decision }: { decision: string }) {
  const tone =
    decision === 'block'
      ? 'text-red-700 dark:text-red-300'
      : decision === 'quarantine'
        ? 'text-amber-700 dark:text-amber-300'
        : decision === 'audit'
          ? 'text-violet-700 dark:text-violet-300'
          : 'text-emerald-700 dark:text-emerald-300'
  return <span className={cn('font-semibold uppercase', tone)}>{decision}</span>
}

export function AiGatewayPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<AiGatewaySummaryResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAiGatewaySummary()
      setSummary(data)
      if (data == null) {
        setError('AI Gateway APIs unavailable.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = [
    { label: 'Allow', value: summary?.allow_count ?? 0, testid: 'ai-gateway-allow-count' },
    { label: 'Audit', value: summary?.audit_count ?? 0, testid: 'ai-gateway-audit-count' },
    { label: 'Block', value: summary?.block_count ?? 0, testid: 'ai-gateway-block-count' },
    { label: 'Quarantine', value: summary?.quarantine_count ?? 0, testid: 'ai-gateway-quarantine-count' },
  ]

  return (
    <div className="space-y-4" data-testid="ai-gateway-page">
      <section className="rounded-xl border border-slate-200/90 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden />
            AI Gateway
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200/90 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Refresh
          </button>
        </div>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-gdc-muted">
          Read-only MVP — prompt inspection and policy enforcement before provider calls (mock provider).
        </p>
        {error ? (
          <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="ai-gateway-decision-counts">
          {counts.map((item) => (
            <div key={item.label} data-testid={item.testid}>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                {item.label}
              </dt>
              <dd className="text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{item.value}</dd>
            </div>
          ))}
          <div data-testid="ai-gateway-avg-latency">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Avg processing (ms)
            </dt>
            <dd className="text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {summary != null ? Math.round(summary.avg_processing_time_ms) : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Recent AI Gateway requests"
      >
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Recent requests</p>
        <div className="mt-2 overflow-x-auto">
          <table className={opTable} data-testid="ai-gateway-recent-requests">
            <thead>
              <tr className={opThRow}>
                <th className={opTh}>Request</th>
                <th className={opTh}>Stream</th>
                <th className={opTh}>Level</th>
                <th className={opTh}>Decision</th>
                <th className={opTh}>Provider</th>
                <th className={opTh}>Ms</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.recent_requests ?? []).map((row: AiGatewayRequestEntry) => (
                <tr key={row.request_id} className={opTr}>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>{row.request_id.slice(0, 8)}…</td>
                  <td className={opTd}>{row.stream_id ?? '—'}</td>
                  <td className={opTd}>{row.classification_level}</td>
                  <td className={opTd}>
                    <DecisionBadge decision={row.decision} />
                  </td>
                  <td className={opTd}>{row.provider}</td>
                  <td className={cn(opTd, 'tabular-nums')}>{row.processing_time_ms}</td>
                </tr>
              ))}
              {(summary?.recent_requests?.length ?? 0) === 0 ? (
                <tr className={opTr}>
                  <td className={opTd} colSpan={6}>
                    No requests recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="AI Gateway policies"
      >
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Policies</p>
        <div className="mt-2 overflow-x-auto">
          <table className={opTable} data-testid="ai-gateway-policies-table">
            <thead>
              <tr className={opThRow}>
                <th className={opTh}>Name</th>
                <th className={opTh}>Enabled</th>
                <th className={opTh}>Condition</th>
                <th className={opTh}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.policies ?? []).map((policy: AiGatewayPolicyEntry) => (
                <tr key={policy.id} className={opTr}>
                  <td className={opTd}>{policy.name}</td>
                  <td className={opTd}>{policy.enabled ? 'yes' : 'no'}</td>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>
                    {policy.condition_summary || JSON.stringify(policy.condition_json)}
                  </td>
                  <td className={opTd}>
                    <DecisionBadge decision={policy.action_type} />
                  </td>
                </tr>
              ))}
              {(summary?.policies?.length ?? 0) === 0 ? (
                <tr className={opTr}>
                  <td className={opTd} colSpan={4}>
                    No policies configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
