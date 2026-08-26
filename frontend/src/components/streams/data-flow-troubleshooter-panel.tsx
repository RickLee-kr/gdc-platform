import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shield, Stethoscope } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchStreamDataFlowTroubleshoot,
  type DataFlowTroubleshootResponse,
  type DataFlowTroubleshootStage,
} from '../../api/gdcRuntimeTroubleshoot'
import { logsPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'

const STAGE_LABELS: Record<string, string> = {
  source_fetch: 'Source Fetch',
  extraction: 'Extraction',
  transform: 'Transform',
  protection: 'Protection',
  classification: 'Classification',
  policy: 'Policy',
  destination: 'Destination',
  checkpoint: 'Checkpoint',
  none: 'None',
}

function StageToneIcon({ status }: { status: DataFlowTroubleshootStage['status'] }) {
  if (status === 'problem') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
  if (status === 'attention') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
}

type Props = {
  streamId: number
  streamPathId?: string
}

export function DataFlowTroubleshooterPanel({ streamId, streamPathId }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DataFlowTroubleshootResponse | null>(null)
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
      const body = await fetchStreamDataFlowTroubleshoot(streamId)
      if (!mountedRef.current) return
      setData(body)
    } catch (e: unknown) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load troubleshoot diagnosis')
      setData(null)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [streamId])

  useEffect(() => {
    void load()
  }, [load])

  const logsHref = logsPath(streamPathId ?? String(streamId))

  return (
    <section
      aria-label="Data Flow Troubleshooter"
      data-testid="data-flow-troubleshooter-panel"
      className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-border">
        <div className="flex items-start gap-2">
          <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div>
            <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Data Flow Troubleshooter</h3>
            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
              Structured diagnosis from delivery evidence — no manual log correlation required
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="data-flow-troubleshooter-refresh"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-section"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 px-4 py-8 text-[12px] text-slate-500" role="status" data-testid="data-flow-troubleshooter-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Diagnosing stream…
        </div>
      ) : null}

      {error ? (
        <div className="px-4 py-4 text-[12px] text-red-600 dark:text-red-300" data-testid="data-flow-troubleshooter-error" role="alert">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-4 p-4 lg:grid-cols-12" data-testid="data-flow-troubleshooter-body">
          <div className="space-y-3 lg:col-span-5">
            <div
              className={cn(
                'rounded-lg border px-3 py-2',
                data.health === 'UNHEALTHY' && 'border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/30',
                data.health === 'DEGRADED' && 'border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20',
                (data.health === 'HEALTHY' || data.health === 'IDLE') &&
                  'border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20',
              )}
              data-testid="data-flow-troubleshooter-summary"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Health · {data.health}
              </p>
              <dl className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Current issue</dt>
                  <dd className="font-semibold text-slate-900 dark:text-slate-100" data-testid="dft-current-issue">
                    {data.current_issue}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Stage</dt>
                  <dd data-testid="dft-stage">{STAGE_LABELS[data.diagnosis_stage] ?? data.diagnosis_stage}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Impact</dt>
                  <dd data-testid="dft-impact">{data.impact_summary}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Checkpoint</dt>
                  <dd data-testid="dft-checkpoint">
                    <span className="inline-flex items-center gap-1">
                      <Shield className="h-3 w-3 text-slate-400" aria-hidden />
                      {data.checkpoint_state === 'held'
                        ? 'Held'
                        : data.checkpoint_state === 'safe'
                          ? 'Safe / unchanged'
                          : 'Unknown'}
                      <span className="text-slate-500 dark:text-gdc-muted">— {data.checkpoint_detail}</span>
                    </span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium text-slate-500 dark:text-gdc-muted">Recovery</dt>
                  <dd data-testid="dft-recovery">{data.recovery}</dd>
                </div>
              </dl>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Actions</p>
              <ul className="flex flex-wrap gap-2" data-testid="dft-actions">
                {data.actions.map((action) =>
                  action.id === 'view_evidence' ? (
                    <li key={action.id}>
                      <Link
                        to={logsHref}
                        className="inline-flex rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200"
                      >
                        {action.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={action.id}>
                      <span className="inline-flex rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-gdc-border dark:text-slate-300">
                        {action.label}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>

          <div className="lg:col-span-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Diagnosis stages
            </p>
            <ul className="divide-y divide-slate-200/70 rounded-lg border border-slate-200/80 dark:divide-gdc-divider dark:border-gdc-border" data-testid="dft-stages">
              {data.stages.map((stage) => (
                <li key={stage.stage} className="flex items-start gap-2 px-3 py-2" data-testid={`dft-stage-${stage.stage}`}>
                  <StageToneIcon status={stage.status} />
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                      {STAGE_LABELS[stage.stage] ?? stage.stage}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-gdc-muted">{stage.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Evidence</p>
            {data.evidence.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="dft-evidence-empty">
                No problem evidence in the recent window
              </p>
            ) : (
              <ul className="space-y-2" data-testid="dft-evidence">
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
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
