import { Copy, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CurlImportDraft } from '../../api/gdcBackup'
import {
  cloneTemplateDraft,
  deleteTemplateDraft,
  fetchTemplateDraftDetail,
  fetchTemplateDraftWizardPayload,
  fetchTemplateDraftsList,
  type TemplateDraftDetail,
  type TemplateDraftSummary,
} from '../../api/gdcTemplateDrafts'
import { navigateToConnectorWizardWithDraft } from '../../utils/httpImportDraft'
import { cn } from '../../lib/utils'

export function TemplateDraftsPanel() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TemplateDraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TemplateDraftDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchTemplateDraftsList())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await fetchTemplateDraftDetail(id))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const onDelete = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        await deleteTemplateDraft(id)
        if (selectedId === id) {
          setSelectedId(null)
          setDetail(null)
        }
        await reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    },
    [reload, selectedId],
  )

  const onClone = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const cloned = await cloneTemplateDraft(id)
        await reload()
        await openDetail(cloned.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    },
    [openDetail, reload],
  )

  const onOpenWizard = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const payload = await fetchTemplateDraftWizardPayload(id)
        const draft = {
          draft_kind: 'template_draft',
          connector: payload.connector_draft,
          stream: payload.stream_draft ?? undefined,
          parsed: {},
          warnings: [],
        } as CurlImportDraft
        navigateToConnectorWizardWithDraft(navigate, draft)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    },
    [navigate],
  )

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[12px] text-slate-700 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted">
        Template Drafts are reusable builder artifacts stored under <code className="font-mono">templates/drafts/</code>. They are not
        published templates and are never executed at runtime until you materialize a connector and stream.
      </div>

      {loading ? <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Loading drafts…</p> : null}
      {error ? (
        <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300/80 px-3 py-6 text-center text-[13px] text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
          No Template Drafts yet. Save one from cURL/Postman import or after a successful API Test.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void openDetail(row.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition',
                  selectedId === row.id
                    ? 'border-violet-400 bg-violet-50/80 dark:border-violet-500/40 dark:bg-violet-500/10'
                    : 'border-slate-200 bg-white hover:border-violet-300 dark:border-gdc-border dark:bg-gdc-card',
                )}
              >
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{row.display_name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">{row.id}</p>
                <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                  {[row.vendor, row.product, row.import_source].filter(Boolean).join(' · ')}
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card">
          {detailLoading ? <p className="text-[12px] text-slate-600">Loading draft…</p> : null}
          {!detailLoading && !detail ? (
            <p className="text-[12px] text-slate-600 dark:text-gdc-muted">Select a draft to view metadata and actions.</p>
          ) : null}
          {detail ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{detail.display_name}</h3>
                  <p className="font-mono text-[10px] text-slate-500">{detail.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === detail.id}
                    onClick={() => void onOpenWizard(detail.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-2.5 text-[11px] font-semibold text-white"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Open wizard
                  </button>
                  <button
                    type="button"
                    disabled={busyId === detail.id}
                    onClick={() => void onClone(detail.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold dark:border-gdc-border"
                  >
                    <Copy className="h-3.5 w-3.5" /> Clone
                  </button>
                  <button
                    type="button"
                    disabled={busyId === detail.id}
                    onClick={() => void onDelete(detail.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2.5 text-[11px] font-semibold text-red-800 dark:border-red-900/40 dark:text-red-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
              <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Import source</dt>
                  <dd>{detail.import_source}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Auth type</dt>
                  <dd>{detail.auth_type ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Event array path</dt>
                  <dd className="font-mono">{detail.inference?.event_array_path ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Use case</dt>
                  <dd>{detail.use_case ?? '—'}</dd>
                </div>
              </dl>
              {detail.checkpoint_candidate ? (
                <p className="text-[11px] text-slate-700 dark:text-slate-200">
                  <Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-600" aria-hidden />
                  Checkpoint hint: {detail.checkpoint_candidate.field_path} ({detail.checkpoint_candidate.checkpoint_type})
                </p>
              ) : null}
              <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-2 text-[10px] text-slate-100 dark:border-gdc-border">
                {JSON.stringify(detail.normalized_event_preview ?? detail.sample_payload ?? detail.request_structure, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
