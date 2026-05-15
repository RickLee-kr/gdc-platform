import { Database, Loader2, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchRetentionPreview, fetchRetentionStatus, postRetentionRun } from '../../api/gdcRetention'
import type { RetentionPreviewResponse, RetentionRunResponse, RetentionStatusResponse } from '../../api/types/gdcApi'
import { useSessionCapabilities } from '../../lib/rbac'

function formatShortTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  return String(iso).slice(0, 19).replace('T', ' ')
}

export function RuntimeRetentionSection() {
  const caps = useSessionCapabilities()
  const canExecuteRetention = caps.retention_execute === true
  const [preview, setPreview] = useState<RetentionPreviewResponse | null>(null)
  const [status, setStatus] = useState<RetentionStatusResponse | null>(null)
  const [lastRun, setLastRun] = useState<RetentionRunResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [p, s] = await Promise.all([fetchRetentionPreview(), fetchRetentionStatus()])
      setPreview(p)
      setStatus(s)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load retention.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runDry = async () => {
    if (!canExecuteRetention) return
    setBusy(true)
    setErr(null)
    try {
      const r = await postRetentionRun({ dry_run: true })
      setLastRun(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runLive = async () => {
    if (!canExecuteRetention) return
    if (!window.confirm('Run operational retention cleanup now? This deletes aged rows from PostgreSQL.')) return
    setBusy(true)
    setErr(null)
    try {
      const r = await postRetentionRun({ dry_run: false })
      setLastRun(r)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <div
        className="rounded-lg border border-amber-300/70 bg-amber-500/[0.08] px-2.5 py-2 text-[11px] text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/25 dark:text-amber-100"
        role="note"
      >
        <span className="font-semibold">Destructive operation:</span> live cleanup permanently deletes aged operational rows from PostgreSQL
        (delivery logs, validation metrics, backfill history). Dry-run only counts eligible rows.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-slate-500" aria-hidden />
        <h2 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Data retention</h2>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-slate-500 dark:text-gdc-muted">
        PostgreSQL operational cleanup (delivery logs, validation metrics, backfill history). Preview and status are visible to
        viewers; dry-run and live cleanup require Operator or Administrator.
      </p>
      {err ? (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-800 disabled:opacity-50 dark:border-gdc-border dark:text-slate-100"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh preview
        </button>
        {canExecuteRetention ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runDry()}
              className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
            >
              Dry-run cleanup
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runLive()}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-950 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <Play className="h-3 w-3" aria-hidden />
              Run cleanup
            </button>
          </>
        ) : (
          <span className="text-[10px] text-slate-500 dark:text-gdc-muted" role="status">
            Viewer role: retention execution controls are hidden.
          </span>
        )}
      </div>
      {status ? (
        <ul className="mt-2 space-y-1 text-[10px] text-slate-600 dark:text-gdc-muted">
          <li className="flex justify-between gap-2">
            <span>Supplement next (UTC)</span>
            <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
              {formatShortTs(status.supplement_next_after_utc)}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span>Last run (meta)</span>
            <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
              {formatShortTs(status.last_operational_retention_at)}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span>delivery_logs days</span>
            <span className="font-mono tabular-nums">{status.policies.delivery_logs_days ?? '—'}</span>
          </li>
        </ul>
      ) : null}
      {preview?.tables?.length ? (
        <div className="mt-2 max-h-[220px] overflow-auto rounded-lg border border-slate-200 dark:border-gdc-border">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 dark:bg-gdc-section dark:text-gdc-mutedStrong">
              <tr>
                <th className="px-2 py-1 font-semibold">Table</th>
                <th className="px-2 py-1 font-semibold">Eligible</th>
                <th className="px-2 py-1 font-semibold">Oldest</th>
              </tr>
            </thead>
            <tbody>
              {preview.tables.map((t) => (
                <tr key={t.table} className="border-t border-slate-100 dark:border-gdc-divider">
                  <td className="max-w-[140px] truncate px-2.5 py-1.5 font-mono text-[11px] font-medium text-slate-800 dark:text-slate-200">
                    {t.table}
                  </td>
                  <td className="px-2.5 py-1.5 tabular-nums font-medium text-slate-900 dark:text-slate-100">{t.rows_eligible}</td>
                  <td className="px-2.5 py-1.5 tabular-nums text-slate-600 dark:text-gdc-muted">{formatShortTs(t.oldest_row_timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">No preview loaded.</p>
      )}
      {lastRun ? (
        <div className="mt-3 rounded-lg border border-violet-200/90 bg-violet-50/50 p-2.5 text-[11px] dark:border-violet-900/45 dark:bg-violet-950/25">
          <p className="font-semibold text-violet-950 dark:text-violet-100">
            Last execution {lastRun.dry_run ? '(dry-run — no deletes)' : '(live — rows deleted per outcomes)'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {lastRun.outcomes.map((o) => (
              <li key={`${o.table}-${o.status}`} className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                <span className="max-w-[140px] truncate">{o.table}</span>
                <span className="shrink-0 tabular-nums">
                  {o.status} · del {o.deleted_count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
