import { Loader2, Save, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createTemplateDraft,
  previewTemplateDraftInference,
  type TemplateDraftCreatePayload,
  type TemplateDraftImportSource,
  type TemplateDraftInference,
  type TemplateDraftRequestStructure,
} from '../../api/gdcTemplateDrafts'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from '../ui/dialog'

type TemplateDraftPreviewModalProps = {
  open: boolean
  onClose: () => void
  onSaved?: (draftId: string) => void
  importSource: TemplateDraftImportSource
  displayNameDefault: string
  requestStructure: TemplateDraftRequestStructure
  samplePayload?: unknown
  authType?: string | null
  connectorDraft?: Record<string, unknown> | null
  streamDraft?: Record<string, unknown> | null
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.8) return 'text-emerald-700 dark:text-emerald-300'
  if (confidence >= 0.55) return 'text-amber-800 dark:text-amber-200'
  return 'text-slate-600 dark:text-gdc-muted'
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span className={cn('font-mono text-[10px] font-semibold tabular-nums', confidenceTone(value))} title="Heuristic confidence">
      {pct}%
    </span>
  )
}

export function TemplateDraftPreviewModal({
  open,
  onClose,
  onSaved,
  importSource,
  displayNameDefault,
  requestStructure,
  samplePayload,
  authType,
  connectorDraft,
  streamDraft,
}: TemplateDraftPreviewModalProps) {
  const [displayName, setDisplayName] = useState(displayNameDefault)
  const [vendor, setVendor] = useState('')
  const [product, setProduct] = useState('')
  const [useCase, setUseCase] = useState('')
  const [eventArrayPath, setEventArrayPath] = useState<string>('')
  const [inference, setInference] = useState<TemplateDraftInference | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDisplayName(displayNameDefault)
    setVendor('')
    setProduct('')
    setUseCase('')
    setEventArrayPath('')
    setInference(null)
    setError(null)
  }, [open, displayNameDefault])

  const runInference = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await previewTemplateDraftInference({
        sample_payload: samplePayload ?? {},
        vendor: vendor.trim() || null,
        product: product.trim() || null,
        approved_event_array_path: eventArrayPath.trim() || null,
      })
      setInference(result)
      if (!eventArrayPath.trim() && result.event_array_path) {
        setEventArrayPath(result.event_array_path)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [samplePayload, vendor, product, eventArrayPath])

  useEffect(() => {
    if (!open) return
    void runInference()
  }, [open, samplePayload]) // eslint-disable-line react-hooks/exhaustive-deps

  const mappingRows = inference?.mapping_candidates ?? []
  const enrichmentRows = inference?.enrichment_candidates ?? []
  const checkpointRec = inference?.checkpoint_recommendation ?? null

  const samplePreview = useMemo(() => {
    if (samplePayload == null) return null
    try {
      return JSON.stringify(samplePayload, null, 2)
    } catch {
      return String(samplePayload)
    }
  }, [samplePayload])

  const normalizedPreview = useMemo(() => {
    if (!inference?.normalized_event_preview) return null
    return JSON.stringify(inference.normalized_event_preview, null, 2)
  }, [inference?.normalized_event_preview])

  const onSave = useCallback(async () => {
    if (!displayName.trim()) {
      setError('Display name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const approved: TemplateDraftInference = {
        ...(inference ?? {}),
        event_array_path: eventArrayPath.trim() || inference?.event_array_path || null,
      }
      const payload: TemplateDraftCreatePayload = {
        display_name: displayName.trim(),
        vendor: vendor.trim() || null,
        product: product.trim() || null,
        use_case: useCase.trim() || null,
        auth_type: authType ?? null,
        import_source: importSource,
        request_structure: requestStructure,
        sample_payload: samplePayload,
        approved_inference: approved,
        connector_draft: connectorDraft ?? null,
        stream_draft: streamDraft ?? null,
      }
      const saved = await createTemplateDraft(payload)
      onSaved?.(saved.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [
    displayName,
    vendor,
    product,
    useCase,
    authType,
    importSource,
    requestStructure,
    samplePayload,
    inference,
    eventArrayPath,
    connectorDraft,
    streamDraft,
    onSaved,
    onClose,
  ])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPortal>
        <DialogBackdrop className="bg-slate-900/50" />
        <DialogContent className="flex max-h-[min(92vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-gdc-border dark:bg-gdc-card">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-gdc-border">
          <div>
            <DialogTitle id="template-draft-preview-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
              Template Draft preview
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">
              Review heuristic suggestions, adjust fields, then save a reusable draft. Nothing is published automatically.
            </DialogDescription>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-elevated" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">Display name</span>
              <input
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label className="block text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">Vendor</span>
              <input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label className="block text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">Product</span>
              <input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card" value={product} onChange={(e) => setProduct(e.target.value)} />
            </label>
            <label className="block text-[11px] sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">Use case</span>
              <input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card" value={useCase} onChange={(e) => setUseCase(e.target.value)} />
            </label>
          </div>

          <section className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-elevated">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">Event array path</span>
                <input
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 font-mono text-[11px] dark:border-gdc-border dark:bg-gdc-card"
                  value={eventArrayPath}
                  onChange={(e) => setEventArrayPath(e.target.value)}
                  placeholder="$.data.events"
                />
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={() => void runInference()}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold dark:border-gdc-border dark:bg-gdc-card"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Re-run inference
              </button>
            </div>
            {(inference?.event_array_candidates ?? []).length ? (
              <ul className="mt-2 space-y-1 text-[10px] text-slate-700 dark:text-slate-200">
                {(inference?.event_array_candidates ?? []).slice(0, 4).map((c) => (
                  <li key={String(c.path)} className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="font-mono text-violet-700 underline dark:text-violet-300"
                      onClick={() => setEventArrayPath(String(c.path ?? ''))}
                    >
                      {c.path}
                    </button>
                    <ConfidenceBadge value={Number(c.confidence)} />
                    <span className="text-slate-500">{c.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-lg border border-slate-200 p-3 dark:border-gdc-border">
              <h3 className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Mapping candidates</h3>
              {mappingRows.length ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[10px]">
                  {mappingRows.map((row) => (
                    <li key={`${row.output_field}-${row.source_json_path}`} className="flex flex-wrap gap-x-2">
                      <span className="font-semibold">{row.output_field}</span>
                      <span className="font-mono text-violet-700 dark:text-violet-300">{row.source_json_path}</span>
                      <ConfidenceBadge value={Number(row.confidence)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[10px] text-slate-500">No mapping candidates without a JSON sample event.</p>
              )}
            </section>
            <section className="rounded-lg border border-slate-200 p-3 dark:border-gdc-border">
              <h3 className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Enrichment candidates</h3>
              <ul className="mt-2 space-y-1 text-[10px]">
                {enrichmentRows.map((row) => (
                  <li key={row.field_name} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold">{row.field_name}</span>
                    <span className="font-mono">{row.suggested_value}</span>
                    <ConfidenceBadge value={Number(row.confidence)} />
                  </li>
                ))}
              </ul>
              {checkpointRec ? (
                <div className="mt-3 border-t border-slate-200 pt-2 dark:border-gdc-border">
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-gdc-mutedStrong">Checkpoint recommendation</p>
                  <p className="mt-1 font-mono text-[10px]">
                    {checkpointRec.field_path} · {checkpointRec.checkpoint_type}{' '}
                    <ConfidenceBadge value={Number(checkpointRec.confidence)} />
                  </p>
                  <p className="text-[10px] text-slate-500">{checkpointRec.reason}</p>
                </div>
              ) : null}
            </section>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold text-slate-700 dark:text-gdc-mutedStrong">Sample payload</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-2 text-[10px] text-slate-100 dark:border-gdc-border">
                {samplePreview ?? '(no sample — request-only draft)'}
              </pre>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-700 dark:text-gdc-mutedStrong">Expected normalized event</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-2 text-[10px] text-emerald-200 dark:border-gdc-border">
                {normalizedPreview ?? '(run inference with a JSON sample)'}
              </pre>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-gdc-border">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-[12px] font-semibold dark:border-gdc-border">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Template Draft
          </button>
        </footer>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
