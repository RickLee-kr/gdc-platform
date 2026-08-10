import { GitCompare, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  acknowledgeSchemaFieldDrift,
  fetchStreamSchemaFieldDrifts,
  fetchStreamSchemaFieldDriftsSummary,
  resetStreamSchemaBaseline,
  type SchemaFieldDriftFinding,
  type StreamSchemaFieldDriftsSummaryResponse,
} from '../../api/gdcSchemaDrift'
import { notifyStreamGovernanceChanged } from '../../lib/stream-governance-events'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

function formatDriftTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'field_added':
      return 'Field added'
    case 'field_removed':
      return 'Field removed'
    case 'field_type_changed':
      return 'Type changed'
    default:
      return category
  }
}

export function SchemaDriftPanel({
  streamId,
  canOperate,
}: {
  streamId: number
  canOperate: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamSchemaFieldDriftsSummaryResponse | null>(null)
  const [findings, setFindings] = useState<SchemaFieldDriftFinding[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [resetReason, setResetReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, d] = await Promise.all([
        fetchStreamSchemaFieldDriftsSummary(streamId),
        fetchStreamSchemaFieldDrifts(streamId, 'open'),
      ])
      setSummary(s)
      setFindings(d?.findings ?? [])
      if (s == null && d == null) {
        setError('Schema drift APIs unavailable.')
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

  async function onAcknowledge(findingId: number) {
    if (!canOperate) return
    setActionBusy(true)
    setMessage(null)
    try {
      await acknowledgeSchemaFieldDrift(streamId, findingId)
      setMessage('Finding acknowledged.')
      await load()
      notifyStreamGovernanceChanged(streamId)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  async function onResetBaseline() {
    if (!canOperate || !resetReason.trim()) return
    setActionBusy(true)
    setMessage(null)
    try {
      const res = await resetStreamSchemaBaseline(streamId, resetReason.trim())
      setResetReason('')
      setMessage(
        res
          ? `Baseline reset to v${res.baseline_version}; ${res.resolved_open_finding_count} open finding(s) resolved.`
          : 'Baseline reset completed.',
      )
      await load()
      notifyStreamGovernanceChanged(streamId)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Schema drift"
      data-testid="schema-drift-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <GitCompare className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          Schema Drift
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
      {message ? (
        <p className="mt-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-200" role="status">
          {message}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Open drift</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.open_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Baseline version</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.baseline_version ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Baseline established</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {formatDriftTime(summary?.baseline_established_at)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Baseline reset</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {formatDriftTime(summary?.baseline_reset_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 overflow-x-auto">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Category</th>
              <th className={opTh}>Path</th>
              <th className={opTh}>Status</th>
              <th className={opTh}>First detected</th>
              <th className={opTh}>Last confirmed</th>
              {canOperate ? <th className={opTh}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {findings.length === 0 ? (
              <tr className={opTr}>
                <td className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')} colSpan={canOperate ? 6 : 5}>
                  {loading ? 'Loading…' : 'No open drift findings.'}
                </td>
              </tr>
            ) : (
              findings.map((f) => (
                <tr key={f.id} className={opTr} data-testid={`schema-drift-row-${f.id}`}>
                  <td className={opTd}>{categoryLabel(f.category)}</td>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>{f.field_path}</td>
                  <td className={opTd}>{f.status}</td>
                  <td className={opTd}>{formatDriftTime(f.first_detected_at)}</td>
                  <td className={opTd}>{formatDriftTime(f.last_confirmed_at)}</td>
                  {canOperate ? (
                    <td className={opTd}>
                      <button
                        type="button"
                        disabled={actionBusy || f.status !== 'open'}
                        onClick={() => void onAcknowledge(f.id)}
                        className="rounded border border-slate-200/90 px-2 py-0.5 text-[10px] font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover"
                      >
                        Acknowledge
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canOperate ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-gdc-border">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-[10px] font-medium text-slate-600 dark:text-gdc-muted">
            Reset reason
            <input
              type="text"
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
              placeholder="e.g. vendor upgrade"
              className="h-8 rounded-md border border-slate-200/90 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={actionBusy || !resetReason.trim()}
            onClick={() => void onResetBaseline()}
            className="inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            data-testid="schema-drift-reset-baseline"
          >
            {actionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Reset Baseline
          </button>
        </div>
      ) : null}
    </section>
  )
}
