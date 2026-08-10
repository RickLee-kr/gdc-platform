import { Eye, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createProtectionRule,
  defaultProtectionModeForClass,
  resolveSensitiveFinding,
  type ProtectionMode,
} from '../../api/gdcProtection'
import {
  acknowledgeSensitiveFinding,
  fetchStreamSensitiveFindings,
  fetchStreamSensitiveFindingsSummary,
  type SensitiveFinding,
  type StreamSensitiveFindingsSummaryResponse,
} from '../../api/gdcSensitiveFindings'
import { notifyStreamGovernanceChanged } from '../../lib/stream-governance-events'
import { compatibleGovernancePreload } from '../../lib/stream-governance-snapshot'
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
  initialSummary,
}: {
  streamId: number
  canOperate: boolean
  initialSummary?: StreamSensitiveFindingsSummaryResponse | null
}) {
  const preload = compatibleGovernancePreload(streamId, initialSummary)
  const preloadRef = useRef(preload)
  preloadRef.current = preload
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamSensitiveFindingsSummaryResponse | null>(preload ?? null)
  const [findings, setFindings] = useState<SensitiveFinding[]>([])
  const [acknowledgedFindings, setAcknowledgedFindings] = useState<SensitiveFinding[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [applyFindingId, setApplyFindingId] = useState<number | null>(null)
  const [applyMode, setApplyMode] = useState<ProtectionMode>('full_mask')

  useEffect(() => {
    if (preload != null) setSummary(preload)
  }, [preload])

  const load = useCallback(async (opts?: { skipSummary?: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const skipSummary = opts?.skipSummary === true
      if (skipSummary) {
        const [d, ack] = await Promise.all([
          fetchStreamSensitiveFindings(streamId, 'open'),
          fetchStreamSensitiveFindings(streamId, 'acknowledged'),
        ])
        setFindings(d?.findings ?? [])
        setAcknowledgedFindings(ack?.findings ?? [])
        if (preloadRef.current == null && d == null) {
          setError('Sensitive findings APIs unavailable.')
        }
        return
      }
      const [s, d, ack] = await Promise.all([
        fetchStreamSensitiveFindingsSummary(streamId),
        fetchStreamSensitiveFindings(streamId, 'open'),
        fetchStreamSensitiveFindings(streamId, 'acknowledged'),
      ])
      setSummary(s)
      setFindings(d?.findings ?? [])
      setAcknowledgedFindings(ack?.findings ?? [])
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
    const skipSummary = preloadRef.current != null
    void load({ skipSummary })
  }, [streamId, load])

  async function onAcknowledge(findingId: number) {
    if (!canOperate) return
    setActionBusy(true)
    setMessage(null)
    try {
      await acknowledgeSensitiveFinding(streamId, findingId)
      setMessage('Finding acknowledged.')
      await load()
      notifyStreamGovernanceChanged(streamId)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  function openApplyModal(finding: SensitiveFinding) {
    setApplyFindingId(finding.id)
    setApplyMode(defaultProtectionModeForClass(finding.sensitivity_class))
  }

  async function onApplyProtection() {
    if (!canOperate || applyFindingId == null) return
    const finding =
      acknowledgedFindings.find((f) => f.id === applyFindingId) ??
      findings.find((f) => f.id === applyFindingId)
    if (!finding) return
    setActionBusy(true)
    setMessage(null)
    try {
      await createProtectionRule(streamId, {
        field_path: finding.field_path,
        sensitivity_class: finding.sensitivity_class,
        protection_mode: applyMode,
        source_finding_id: finding.id,
      })
      setMessage('Protection rule created (finding resolved).')
      setApplyFindingId(null)
      await load()
      notifyStreamGovernanceChanged(streamId)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  async function onFalsePositive(findingId: number) {
    if (!canOperate) return
    setActionBusy(true)
    setMessage(null)
    try {
      await resolveSensitiveFinding(streamId, findingId, 'false_positive')
      setMessage('Marked as false positive.')
      await load()
      notifyStreamGovernanceChanged(streamId)
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

      {acknowledgedFindings.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Acknowledged — apply protection</p>
          <table className={cn(opTable, 'mt-2')}>
            <thead>
              <tr className={opThRow}>
                <th className={opTh}>Path</th>
                <th className={opTh}>Class</th>
                {canOperate ? <th className={opTh}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {acknowledgedFindings.map((f) => (
                <tr key={`ack-${f.id}`} className={opTr}>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>{f.field_path}</td>
                  <td className={opTd}>{classLabel(f.sensitivity_class)}</td>
                  {canOperate ? (
                    <td className={opTd}>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => openApplyModal(f)}
                          className="rounded border border-indigo-300/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                        >
                          Apply protection
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void onFalsePositive(f.id)}
                          className="rounded border border-slate-200/90 px-2 py-0.5 text-[10px] font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover"
                        >
                          False positive
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {applyFindingId != null && canOperate ? (
        <div
          className="mt-3 rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-3 dark:border-indigo-500/30 dark:bg-indigo-950/20"
          role="dialog"
          aria-label="Apply protection"
        >
          <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">Protection mode</p>
          <select
            className="mt-2 w-full max-w-xs rounded border border-slate-200/90 bg-white px-2 py-1 text-[11px] dark:border-gdc-border dark:bg-gdc-card"
            value={applyMode}
            onChange={(e) => setApplyMode(e.target.value as ProtectionMode)}
          >
            <option value="full_mask">Full mask</option>
            <option value="partial_mask">Partial mask</option>
            <option value="hash">Hash</option>
            <option value="tokenization">Tokenization</option>
          </select>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void onApplyProtection()}
              className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => setApplyFindingId(null)}
              className="rounded border border-slate-200/90 px-2 py-1 text-[10px] font-semibold dark:border-gdc-border"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
