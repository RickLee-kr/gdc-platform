import { Loader2, RefreshCw, Scale } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchStreamPolicyRules,
  fetchStreamPolicySummary,
  type PolicyRule,
  type StreamPolicySummaryResponse,
} from '../../api/gdcPolicy'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

export function PolicyPanel({ streamId }: { streamId: number }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamPolicySummaryResponse | null>(null)
  const [rules, setRules] = useState<PolicyRule[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, r] = await Promise.all([
        fetchStreamPolicySummary(streamId),
        fetchStreamPolicyRules(streamId),
      ])
      setSummary(s)
      setRules(r?.rules ?? [])
      if (s == null && r == null) {
        setError('Policy APIs unavailable.')
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
      aria-label="Policy"
      data-testid="policy-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Scale className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          Policy
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

      <p className="mt-3 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Policy metrics</p>
      <dl className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3" data-testid="policy-metrics">
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Total policies</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.total_policies ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Matched policies</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.matched_policies ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Audit events</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.audit_events ?? '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 overflow-x-auto" data-testid="policy-rules-table">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Name</th>
              <th className={opTh}>Condition</th>
              <th className={opTh}>Action</th>
              <th className={opTh}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr className={opTr}>
                <td className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')} colSpan={4}>
                  {loading ? 'Loading…' : 'No policy rules.'}
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className={opTr} data-testid={`policy-rule-row-${rule.id}`}>
                  <td className={opTd}>{rule.name}</td>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>
                    {rule.condition_json?.sensitivity_class ?? '—'}
                  </td>
                  <td className={opTd}>{rule.action_type}</td>
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
