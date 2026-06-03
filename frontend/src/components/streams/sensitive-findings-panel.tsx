import { Eye, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  acknowledgeSensitiveFinding,
  fetchStreamSensitiveFindings,
  fetchStreamSensitiveFindingsSummary,
  type SensitiveFinding,
  type StreamSensitiveFindingsSummaryResponse,
} from '../../api/gdcSensitiveFindings'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function classLabel(sensitivityClass: string): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'Secret'
    case 'pii':
      return 'PII'
    case 'security_metadata':
      return 'Security metadata'
    default:
      return sensitivityClass
  }
}

function classBadgeClass(sensitivityClass: string): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200'
    case 'pii':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
    case 'security_metadata':
      return 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
    default:
      return 'bg-slate-100 text-slate-800 dark:bg-gdc-rowHover dark:text-slate-200'
  }
}

export function SensitiveFindingsPanel({
  streamId,
  canOperate,
}: {
  streamId: number
  canOperate: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamSensitiveFindingsSummaryResponse | null>(null)
  const [findings, setFindings] = useState<SensitiveFinding[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, d] = await Promise.all([
        fetchStreamSensitiveFindingsSummary(streamId),
        fetchStreamSensitiveFindings(streamId, 'open'),
      ])
      setSummary(s)
      setFindings(d?.findings ?? [])
      if (s == null && d == null) {
        setError('Sensitive findings APIs unavailable.')
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
      await acknowledgeSensitiveFinding(streamId, findingId)
      setMessage('Finding acknowledged.')
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  const detectionEnabled = summary?.detection_enabled ?? true

  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Sensitive findings"
      data-testid="sensitive-findings-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Eye className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden />
          Sensitive Detection
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

      {!detectionEnabled ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted" role="status">
          Sensitive detection disabled
        </p>
      ) : null}

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800 dark:bg-gdc-rowHover dark:text-slate-100">
          Open {summary?.open_count ?? '—'}
        </span>
        <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold', classBadgeClass('secret'))}>
          Secret {summary?.by_class?.secret ?? 0}
        </span>
        <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold', classBadgeClass('pii'))}>
          PII {summary?.by_class?.pii ?? 0}
        </span>
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-[10px] font-semibold',
            classBadgeClass('security_metadata'),
          )}
        >
          Security metadata {summary?.by_class?.security_metadata ?? 0}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Path</th>
              <th className={opTh}>Class</th>
              <th className={opTh}>Method</th>
              <th className={opTh}>Detected</th>
              <th className={opTh}>Drift</th>
              {canOperate ? <th className={opTh}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {findings.length === 0 ? (
              <tr className={opTr}>
                <td
                  className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')}
                  colSpan={canOperate ? 6 : 5}
                >
                  {loading ? 'Loading…' : 'No open sensitive findings.'}
                </td>
              </tr>
            ) : (
              findings.map((f) => (
                <tr key={f.id} className={opTr} data-testid={`sensitive-finding-row-${f.id}`}>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>{f.field_path}</td>
                  <td className={opTd}>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', classBadgeClass(f.sensitivity_class))}>
                      {classLabel(f.sensitivity_class)}
                    </span>
                  </td>
                  <td className={opTd}>{f.detection_method}</td>
                  <td className={opTd}>{formatTime(f.first_detected_at)}</td>
                  <td className={opTd}>
                    {f.related_drift_finding_id != null ? (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">
                        New field
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
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
    </section>
  )
}
