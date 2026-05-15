import { type ReactNode, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../../lib/utils'
import { fetchCatalogSnapshot, type CatalogSnapshot } from '../../../api/gdcCatalog'
import { fetchConnectorById } from '../../../api/gdcConnectors'
import { resetInheritedConnectorFields, wizardConnectorPatchFromApi, type WizardState } from './wizard-state'

type StepSourceProps = {
  state: WizardState
  onChange: (next: Partial<WizardState['connector']>) => void
}

const inputCls =
  'h-9 w-full rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

export function StepSource({ state, onChange }: StepSourceProps) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryCounter, setRetryCounter] = useState(0)
  const [detailBusy, setDetailBusy] = useState(false)
  const c = state.connector

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const snap = await fetchCatalogSnapshot()
      if (cancelled) return
      setSnapshot(snap)
      setLoading(false)
      onChange({ candidates: { connectors: snap.connectors, sources: snap.sources }, apiBacked: snap.apiBacked })
    })()
    return () => {
      cancelled = true
    }
  }, [retryCounter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (c.connectorId == null) return
    let cancelled = false
    setDetailBusy(true)
    void (async () => {
      const row = await fetchConnectorById(c.connectorId)
      if (cancelled || !row) {
        if (!cancelled) setDetailBusy(false)
        return
      }
      onChange({
        connectorId: row.id,
        sourceId: row.source_id ?? null,
        ...wizardConnectorPatchFromApi(row),
      })
      if (!cancelled) setDetailBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [c.connectorId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200/80 bg-white p-6 text-center shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-violet-600" aria-hidden />
        <p className="mt-3 text-[12px] font-medium text-slate-700 dark:text-slate-200">Loading connector catalog…</p>
      </section>
    )
  }

  if (!snapshot || snapshot.connectors.length === 0) {
    return (
      <section className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10">
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Create a Generic HTTP Connector first</h3>
        <p className="mt-1 text-[12px] text-amber-800 dark:text-amber-300">
          This wizard only lets you choose an existing connector. Base URL, authentication, and headers are inherited from
          the values saved on that connector.
        </p>
        <Link
          to="/connectors/new"
          className="mt-3 inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
        >
          Go to Connector Create Page
        </Link>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Select Connector</h3>
          <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
            Stream-specific settings are configured in later steps. Here you only select a saved connector; its linked Source
            is bound automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRetryCounter((n) => n + 1)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Refresh
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Connector *">
          <select
            value={c.connectorId ?? ''}
            disabled={detailBusy}
            onChange={(e) => {
              const raw = e.target.value
              const id = raw ? Number(raw) : null
              if (id == null || Number.isNaN(id)) {
                onChange({ connectorId: null, sourceId: null, ...resetInheritedConnectorFields() })
                return
              }
              onChange({ connectorId: id })
            }}
            className={inputCls}
          >
            <option value="">Select connector</option>
            {snapshot.connectors.map((conn) => (
              <option key={conn.id} value={conn.id}>
                {conn.name}
              </option>
            ))}
          </select>
        </Field>

        {detailBusy ? (
          <p className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-gdc-muted">
            <Loader2 className="h-4 w-4 animate-spin text-violet-600" aria-hidden />
            Loading connector details…
          </p>
        ) : null}

        {c.connectorId != null && !detailBusy ? (
          <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-[11px] dark:border-gdc-border dark:bg-gdc-card">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Inherited from connector (read-only)</p>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Name</dt>
                <dd className="max-w-[70%] text-right font-medium text-slate-800 dark:text-slate-200">{c.connectorName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">
                  {c.sourceType === 'S3_OBJECT_POLLING'
                    ? 'Endpoint URL'
                    : c.sourceType === 'REMOTE_FILE_POLLING'
                      ? 'SSH host'
                      : 'Base URL'}
                </dt>
                <dd className="max-w-[70%] break-all text-right font-medium text-slate-800 dark:text-slate-200">{c.hostBaseUrl || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Auth</dt>
                <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{c.authType}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">{label}</label>
      {children}
    </div>
  )
}
