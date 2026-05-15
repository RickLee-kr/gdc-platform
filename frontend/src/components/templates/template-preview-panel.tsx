import { X } from 'lucide-react'
import type { TemplateDetailRead } from '../../api/types/gdcApi'
import { cn } from '../../lib/utils'

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = JSON.stringify(value ?? {}, null, 2)
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{title}</p>
      <pre className="max-h-48 overflow-auto rounded-md border border-slate-200/80 bg-slate-50 p-2 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100">
        {text}
      </pre>
    </div>
  )
}

export function TemplatePreviewPanel({
  open,
  templateId,
  detail,
  loading,
  onClose,
}: {
  open: boolean
  templateId: string | null
  detail: TemplateDetailRead | null
  loading: boolean
  onClose: () => void
}) {
  if (!open) return null

  const preview = (detail?.preview as Record<string, unknown> | undefined) ?? {}
  const instructions = Array.isArray(detail?.setup_instructions) ? (detail?.setup_instructions as string[]) : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="presentation" onMouseDown={onClose}>
      <aside
        className={cn(
          'flex h-full w-full max-w-xl flex-col border-l border-slate-200/80 bg-white shadow-2xl dark:border-gdc-border dark:bg-gdc-card',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Template preview"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-border">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">Preview</p>
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
              {detail && typeof detail.name === 'string' ? detail.name : templateId}
            </h2>
            {detail && typeof detail.category === 'string' ? (
              <p className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">{detail.category}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Loading template…</p>
          ) : detail ? (
            <>
              {typeof detail.description === 'string' ? (
                <p className="text-[13px] leading-relaxed text-slate-700 dark:text-gdc-mutedStrong">{detail.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {typeof detail.source_type === 'string' ? (
                  <span className="rounded border border-slate-200/90 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-elevated dark:text-slate-200">
                    {detail.source_type}
                  </span>
                ) : null}
                {typeof detail.auth_type === 'string' ? (
                  <span className="rounded border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:text-violet-200">
                    {detail.auth_type}
                  </span>
                ) : null}
              </div>
              {instructions.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Setup</p>
                  <ol className="list-decimal space-y-1 pl-4 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                    {instructions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <JsonBlock title="Sample API structure" value={preview.sample_api_structure} />
              <JsonBlock title="Mapping defaults" value={detail.mapping_defaults} />
              <JsonBlock title="Enrichment defaults" value={detail.enrichment_defaults} />
              <JsonBlock title="Checkpoint defaults" value={detail.checkpoint_defaults} />
              <JsonBlock title="Route suggestions" value={detail.route_suggestions} />
              {typeof preview.checkpoint_strategy === 'string' ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                    Checkpoint strategy
                  </p>
                  <p className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">{preview.checkpoint_strategy}</p>
                </div>
              ) : null}
              {typeof preview.route_recommendations === 'string' ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                    Route recommendations
                  </p>
                  <p className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">{preview.route_recommendations}</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-slate-600 dark:text-gdc-muted">No template loaded.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
