import type { WizardState } from './wizard-state'

type ConnectJsonPreviewPanelProps = {
  state: WizardState
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ConnectJsonPreviewPanel({ state }: ConnectJsonPreviewPanelProps) {
  const t = state.apiTest
  if (t.status !== 'success' || t.rawResponse == null) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preview</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Run a sample fetch on the <span className="font-semibold">API Test</span> tab to inspect the raw JSON response here.
        </p>
      </section>
    )
  }

  const summary = t.analysis?.responseSummary
  const sizeLabel = formatBytes(summary?.approx_size_bytes ?? null)
  const topKeys = summary?.top_level_keys ?? []

  return (
    <section className="space-y-3" data-testid="wizard-connect-preview-panel">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Preview</h3>
        <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
          Inspect the formatted and raw response before selecting records and checkpoint fields.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <PreviewStat label="HTTP status" value={t.statusCode != null ? String(t.statusCode) : '—'} />
        <PreviewStat label="Records detected" value={String(t.eventCount)} />
        <PreviewStat label="Response size" value={sizeLabel ?? '—'} />
        <PreviewStat label="Root type" value={summary?.root_type ?? '—'} />
      </div>

      {topKeys.length > 0 ? (
        <div className="rounded-md border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Top-level keys</p>
          <p className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">{topKeys.join(', ')}</p>
        </div>
      ) : null}

      {t.analysis?.previewError ? (
        <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/35 dark:text-amber-100">
          Response could not be fully parsed as JSON ({t.analysis.previewError}). Use Record Selection to adjust extraction paths.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Formatted JSON</p>
          <pre className="mt-1 max-h-[min(52vh,520px)] overflow-auto rounded-md border border-slate-200/80 bg-slate-950 p-2.5 text-[10px] leading-snug text-emerald-200">
            {JSON.stringify(t.rawResponse, null, 2)}
          </pre>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Raw response</p>
          <pre className="mt-1 max-h-[min(52vh,520px)] overflow-auto rounded-md border border-slate-200/80 bg-slate-900 p-2.5 text-[10px] leading-snug text-slate-100">
            {t.rawBody ?? JSON.stringify(t.rawResponse)}
          </pre>
        </div>
      </div>
    </section>
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 dark:border-gdc-border dark:bg-gdc-card">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  )
}
