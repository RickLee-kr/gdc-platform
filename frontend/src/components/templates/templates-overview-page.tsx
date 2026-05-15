import { Layers, Search, Shield, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchTemplateDetail, fetchTemplatesList } from '../../api/gdcTemplates'
import type { TemplateDetailRead, TemplateSummaryRead } from '../../api/types/gdcApi'
import { cn } from '../../lib/utils'
import { TemplatePreviewPanel } from './template-preview-panel'
import { TemplateUseModal } from './template-use-modal'

function categoryTone(cat: string) {
  const c = cat.toLowerCase()
  if (c.includes('xdr') || c.includes('edr') || c.includes('security')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
  }
  if (c.includes('common')) {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100'
  }
  return 'border-slate-300/80 bg-slate-100/80 text-slate-800 dark:border-gdc-borderStrong dark:bg-gdc-section dark:text-gdc-foreground'
}

export function TemplatesOverviewPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TemplateSummaryRead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewDetail, setPreviewDetail] = useState<TemplateDetailRead | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [useOpen, setUseOpen] = useState(false)
  const [useTemplate, setUseTemplate] = useState<TemplateSummaryRead | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void fetchTemplatesList()
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      if (r.category) s.add(r.category)
    }
    return ['all', ...Array.from(s).sort()]
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (category !== 'all' && r.category !== category) return false
      if (!q) return true
      const hay = `${r.name} ${r.description} ${r.template_id} ${r.tags.join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search, category])

  async function openPreview(id: string) {
    setPreviewId(id)
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewDetail(null)
    try {
      const d = await fetchTemplateDetail(id)
      setPreviewDetail(d)
    } finally {
      setPreviewLoading(false)
    }
  }

  function closePreview() {
    setPreviewOpen(false)
    setPreviewId(null)
    setPreviewDetail(null)
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-gdc-foreground">Template library</h2>
          <p className="max-w-2xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Browse static integration templates. Templates only generate connector, source, stream, mapping, enrichment, checkpoint,
            and optional route records — they are not executed at runtime.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-[12px] text-slate-600 shadow-sm dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted dark:shadow-gdc-control">
          <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <span className="font-semibold tabular-nums text-slate-900 dark:text-gdc-foreground">{rows.length}</span>
          <span>templates</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card dark:shadow-gdc-card sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-gdc-placeholder" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, vendor, or tag…"
            className="h-9 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/35 dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control dark:placeholder:text-gdc-placeholder dark:focus:border-gdc-primary dark:focus:ring-gdc-primary/40"
            aria-label="Search templates"
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
          <span className="whitespace-nowrap">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 min-w-[10rem] rounded-md border border-slate-200/90 bg-white px-2 text-[13px] shadow-sm dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-600 dark:text-gdc-muted" role="status">
          Loading templates…
        </p>
      ) : null}
      {loadError ? (
        <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[12px] text-slate-700 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted">
        Move or recover configuration with JSON export and preview-first import on the{' '}
        <Link to="/operations/backup" className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
          Backup & Import
        </Link>{' '}
        page.
      </div>

      {!loading && !loadError && filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300/80 bg-slate-50/50 px-3 py-6 text-center text-[13px] text-slate-600 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted dark:shadow-gdc-control">
          No templates match the current filters.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <article
            key={t.template_id}
            className="flex flex-col rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm transition hover:border-violet-300/80 dark:border-gdc-border dark:bg-gdc-card dark:shadow-gdc-card dark:hover:border-violet-500/35"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <Shield className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-semibold text-slate-900 dark:text-gdc-foreground">{t.name}</h3>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-gdc-muted">{t.template_id}</p>
                </div>
              </div>
              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', categoryTone(t.category))}>
                {t.category}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 flex-1 text-[12px] leading-snug text-slate-600 dark:text-gdc-muted">{t.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded border border-slate-200/90 bg-slate-50 px-1.5 py-px text-[10px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-mutedStrong">
                {t.source_type}
              </span>
              <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-800 dark:text-violet-200">
                {t.auth_type}
              </span>
            </div>
            {t.recommended_destinations.length > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted">
                <span className="font-semibold text-slate-600 dark:text-gdc-muted">Destinations: </span>
                {t.recommended_destinations.join(', ')}
              </p>
            ) : null}
            {t.included_components.length > 0 ? (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500 dark:text-gdc-muted">
                <Sparkles className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                {t.included_components.join(' · ')}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-slate-200/90 bg-white text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control dark:hover:border-gdc-borderStrong dark:hover:bg-gdc-cardHover"
                onClick={() => void openPreview(t.template_id)}
              >
                Preview
              </button>
              <button
                type="button"
                className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 sm:flex-none"
                onClick={() => {
                  setUseTemplate(t)
                  setUseOpen(true)
                }}
              >
                Use template
              </button>
            </div>
          </article>
        ))}
      </div>

      <TemplatePreviewPanel
        open={previewOpen}
        templateId={previewId}
        detail={previewDetail}
        loading={previewLoading}
        onClose={closePreview}
      />

      <TemplateUseModal
        open={useOpen}
        template={useTemplate}
        onClose={() => {
          setUseOpen(false)
          setUseTemplate(null)
        }}
        onCreated={(path) => navigate(path)}
      />
    </div>
  )
}
