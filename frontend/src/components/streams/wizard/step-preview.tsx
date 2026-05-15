import { CheckCircle2, ChevronRight, ClipboardCopy, Copy, Search, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import { MappingJsonTree, PanelChrome } from '../mapping-json-tree'
import type { WizardCheckpointFieldType, WizardConfigState, WizardState } from './wizard-state'
import { detectEventRootCandidates, toEventRootRelativePath, wizardExtractEvents } from './wizard-json-extract'

type StepPreviewProps = {
  state: WizardState
  onSetEventArrayPath: (path: string) => void
  onSetEventRootPath: (path: string) => void
  onSetCheckpoint: (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => void
}

/** Fallback when backend analysis is absent (demo / legacy). */
function collectArrayPaths(value: unknown, base: string, out: Array<{ path: string; count: number; sample?: unknown }>): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      out.push({ path: base, count: value.length, sample: value[0] })
    }
    return
  }
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const childBase = base === '$' ? `$.${key}` : `${base}.${key}`
    collectArrayPaths(obj[key], childBase, out)
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function StepPreview({ state, onSetEventArrayPath, onSetEventRootPath, onSetCheckpoint }: StepPreviewProps) {
  const [search, setSearch] = useState('')
  const [jsonCopied, setJsonCopied] = useState(false)
  const [pathCopied, setPathCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const t = state.apiTest
  const analysis = t.analysis
  const currentEventPath = state.stream.eventArrayPath.trim()
  const currentEventRootPath = state.stream.eventRootPath.trim()

  const arrayCandidates = useMemo(() => {
    if (analysis?.detectedArrays?.length) {
      return analysis.detectedArrays.map((a) => ({
        path: a.path,
        count: a.count,
        sample: a.sample_item_preview,
        confidence: a.confidence,
        reason: a.reason,
      }))
    }
    if (!t.rawResponse) return []
    const out: Array<{ path: string; count: number; sample?: unknown; confidence?: number; reason?: string }> = []
    collectArrayPaths(t.rawResponse, '$', out)
    return out.map((o) => ({ ...o, confidence: 0.5, reason: 'Heuristic scan (offline)' }))
  }, [analysis?.detectedArrays, t.rawResponse])

  const checkpointCandidates = analysis?.detectedCheckpointCandidates ?? []
  const firstEventItem = useMemo(() => {
    const root = t.parsedJson ?? t.rawResponse
    const selected = currentEventPath || '$'
    const events = wizardExtractEvents(root, selected)
    return events[0] ?? null
  }, [t.parsedJson, t.rawResponse, currentEventPath])
  const eventRootCandidates = useMemo(() => {
    if (analysis?.eventRootCandidates?.length) return analysis.eventRootCandidates
    return detectEventRootCandidates(firstEventItem)
  }, [analysis?.eventRootCandidates, firstEventItem])

  const summary = analysis?.responseSummary
  const previewIssue = analysis?.previewError
  const rootType =
    summary?.root_type ??
    (t.rawResponse == null ? 'unknown' : Array.isArray(t.rawResponse) ? 'array' : typeof t.rawResponse === 'object' ? 'object' : 'primitive')

  const copyJson = async () => {
    const dv = t.parsedJson ?? t.rawResponse
    const text = typeof dv === 'string' ? dv : formatJson(dv)
    const ok = await copyText(text)
    if (ok) {
      setJsonCopied(true)
      setCopyError(null)
      window.setTimeout(() => setJsonCopied(false), 2000)
      return
    }
    setCopyError('브라우저 복사 권한이 없어 자동 복사에 실패했습니다.')
  }

  const copyPath = async (path: string) => {
    const ok = await copyText(path)
    if (ok) {
      setPathCopied(path)
      setCopyError(null)
      window.setTimeout(() => setPathCopied(null), 2000)
      return
    }
    setCopyError('브라우저 복사 권한이 없어 JSONPath 복사에 실패했습니다.')
  }

  const hasRenderablePayload =
    (t.rawResponse != null && typeof t.rawResponse === 'object') || (t.parsedJson != null && typeof t.parsedJson === 'object')

  if (t.status !== 'success' || (!hasRenderablePayload && !previewIssue)) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">JSON Preview</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Run <span className="font-semibold">Fetch Sample Data</span> (or load placeholder data) on the previous step to render the JSON preview here.
        </p>
      </section>
    )
  }

  const treeValue = (t.parsedJson ?? t.rawResponse) as unknown
  const jsonBlockValue = t.parsedJson ?? t.rawResponse

  const highlightPath =
    currentEventPath && currentEventPath !== '$' ? (currentEventPath.startsWith('$') ? currentEventPath : `$.${currentEventPath}`) : null

  return (
    <section
      id="wizard-json-preview-panel"
      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">JSON Preview</h3>
          <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
            Inspect structure, pick the event array, and optional checkpoint fields — no manual JSONPath typing required.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2.5',
              t.apiBacked
                ? 'border-emerald-200/80 bg-emerald-500/[0.07] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-slate-200 bg-slate-50 dark:border-gdc-border dark:bg-gdc-card',
            )}
          >
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {t.apiBacked ? 'API-backed' : 'Local preview'}
          </span>
          <span className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 dark:border-gdc-border dark:bg-gdc-card">
            {t.eventCount} events
          </span>
        </div>
      </div>

      {previewIssue ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-amber-200/90 bg-amber-500/[0.08] p-3 text-[12px] text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <p className="font-semibold">응답 미리보기 제한 · {previewIssue}</p>
          <p className="mt-1 text-[11px] opacity-90">
            {previewIssue === 'invalid_json_response'
              ? '본문이 JSON으로 파싱되지 않았습니다. 소스가 JSON을 반환하는지 확인하세요.'
              : previewIssue === 'unsupported_content_type'
                ? 'HTML 등 JSON이 아닌 응답입니다. 엔드포인트·Accept 헤더를 확인하세요.'
                : previewIssue === 'response_too_large'
                  ? '응답이 너무 커서 일부만 수신되었을 수 있습니다.'
                  : '구조 분석을 건너뜁니다.'}
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Root type</p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-800 dark:text-slate-100">{rootType}</p>
        </div>
        <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Approx. size</p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-800 dark:text-slate-100">
            {summary?.approx_size_bytes != null ? `${summary.approx_size_bytes.toLocaleString()} bytes` : '—'}
          </p>
        </div>
        <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Top-level keys</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-700 dark:text-slate-200">
            {summary?.top_level_keys?.length
              ? summary.top_level_keys.slice(0, 8).join(', ') + (summary.top_level_keys.length > 8 ? '…' : '')
              : rootType === 'object' && t.rawResponse && typeof t.rawResponse === 'object' && !Array.isArray(t.rawResponse)
                ? Object.keys(t.rawResponse as object)
                    .slice(0, 8)
                    .join(', ')
                : '—'}
          </p>
        </div>
        <div className="rounded-md border border-slate-200/80 bg-slate-50/80 p-2 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Arrays detected</p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-800 dark:text-slate-100">{arrayCandidates.length}</p>
        </div>
      </div>

      {summary?.truncation === 'response_truncated' ? (
        <p className="mt-2 rounded-md border border-amber-200/80 bg-amber-500/[0.06] p-2 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Sample body preview was clipped for transport; parsed JSON and analysis still reflect the full decoded response where available.
        </p>
      ) : null}
      {copyError ? (
        <p className="mt-2 rounded-md border border-red-200/80 bg-red-500/[0.06] p-2 text-[11px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {copyError}
        </p>
      ) : null}

      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
        <div className="flex min-h-0 flex-col gap-1">
          <PanelChrome
            title="Formatted JSON"
            className="min-h-[460px]"
            right={
              <button
                type="button"
                onClick={() => void copyJson()}
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
              >
                <Copy className="h-3 w-3" aria-hidden />
                {jsonCopied ? 'Copied' : 'Copy'}
              </button>
            }
          >
            <pre className="min-h-[420px] max-h-[min(68vh,760px)] overflow-auto rounded-md border border-slate-200/80 bg-slate-950 p-3 text-[10px] leading-snug text-emerald-200 dark:border-gdc-border">
              {typeof jsonBlockValue === 'string' ? jsonBlockValue : formatJson(jsonBlockValue)}
            </pre>
          </PanelChrome>

          <PanelChrome
            title="Tree (collapse · click row to copy JSONPath)"
            className="min-h-[320px]"
            right={
              <div className="relative w-44">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter paths…"
                  className="h-7 w-full rounded border border-slate-200/90 bg-white py-1 pl-7 pr-2 text-[11px] focus:border-violet-300 focus:outline-none dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                />
              </div>
            }
          >
            <div className="min-h-[300px] max-h-[min(60vh,680px)] overflow-auto p-2">
              {typeof treeValue === 'object' && treeValue !== null ? (
                <MappingJsonTree
                  value={treeValue}
                  baseLabel="root"
                  basePath="$"
                  search={search}
                  highlightPathPrefix={highlightPath}
                  onPickPath={(p) => void copyPath(p)}
                  onUseEventArrayPath={(p) => onSetEventArrayPath(p)}
                  onUseEventRootPath={(p) =>
                    onSetEventRootPath(toEventRootRelativePath(p, currentEventPath || '$'))
                  }
                />
              ) : (
                <p className="px-2 py-3 text-[11px] text-slate-500">트리 뷰는 JSON 객체/배열에만 사용할 수 있습니다.</p>
              )}
            </div>
          </PanelChrome>

          {t.extractedEvents.length > 0 ? (
            <PanelChrome title="Extracted event preview" className="mt-1 min-h-[360px]">
              <pre className="min-h-[320px] max-h-[min(56vh,620px)] overflow-auto rounded-md border border-slate-200/80 bg-slate-950 p-3 text-[10px] leading-snug text-emerald-200">
                {JSON.stringify(t.extractedEvents[0], null, 2)}
              </pre>
            </PanelChrome>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col gap-3 lg:sticky lg:top-4">
          <PanelChrome title="Event Extraction">
            <div className="p-3">
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
                Configure event array and optional event root. Extracted event preview is the exact object used in Mapping.
              </p>
              <div className="mt-3 grid gap-2">
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Event Array Path
                  <input
                    value={state.stream.eventArrayPath}
                    onChange={(e) => onSetEventArrayPath(e.target.value)}
                    placeholder="$.hits.hits"
                    className="mt-1 h-8 w-full rounded border border-slate-200/90 bg-white px-2 font-mono text-[11px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </label>
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Event Root Path (optional)
                  <input
                    value={state.stream.eventRootPath}
                    onChange={(e) => onSetEventRootPath(e.target.value)}
                    placeholder="$._source"
                    className="mt-1 h-8 w-full rounded border border-slate-200/90 bg-white px-2 font-mono text-[11px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Event Root candidates</p>
                {eventRootCandidates.length === 0 ? (
                  <p className="text-[11px] italic text-slate-500 dark:text-gdc-muted">No nested object candidates from first event item.</p>
                ) : (
                  eventRootCandidates.map((p) => {
                    const selected = currentEventRootPath === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onSetEventRootPath(p)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-[11px] font-mono',
                          selected
                            ? 'border-violet-500/70 bg-violet-500/[0.08] text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100'
                            : 'border-slate-200/90 bg-white text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100',
                        )}
                      >
                        <span>{p}</span>
                        {selected ? <CheckCircle2 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" aria-hidden /> : null}
                      </button>
                    )
                  })
                )}
              </div>
              <div className="mt-3 space-y-2">
                {arrayCandidates.length === 0 ? (
                  <p className="text-[11px] italic text-slate-500 dark:text-gdc-muted">
                    No object arrays detected. Use whole response below if it is a single event.
                  </p>
                ) : (
                  arrayCandidates.map((c) => {
                    const pathNorm = c.path.startsWith('$') ? c.path : `$.${c.path}`
                    const selected = currentEventPath === pathNorm || currentEventPath === c.path.replace(/^\$\./, '')
                    return (
                      <div
                        key={c.path}
                        className={cn(
                          'flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left text-[12px]',
                          selected
                            ? 'border-violet-500/70 bg-violet-500/[0.08] text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100'
                            : 'border-slate-200/90 bg-white text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => onSetEventArrayPath(pathNorm)}
                            className="min-w-0 flex-1 truncate text-left font-mono text-inherit"
                          >
                            {pathNorm}
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-gdc-elevated dark:text-slate-200">
                              {c.count} items
                            </span>
                            {c.confidence != null ? (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                                {(c.confidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            <button
                              type="button"
                              title="Copy JSONPath"
                              onClick={() => void copyPath(pathNorm)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200/90 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {selected ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" aria-hidden />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
                            )}
                          </div>
                        </div>
                        {c.reason ? <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{c.reason}</p> : null}
                        {pathCopied === pathNorm ? <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">JSONPath copied</p> : null}
                      </div>
                    )
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() => onSetEventArrayPath('')}
                className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50/80 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-gdc-borderStrong dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              >
                Use entire response as single event
              </button>

              <div className="mt-3 rounded-md border border-slate-200/80 bg-slate-50/60 p-2 dark:border-gdc-border dark:bg-gdc-card">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                  <Wand2 className="h-3 w-3" aria-hidden />
                  Current event_array_path
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">
                  {state.stream.useWholeResponseAsEvent
                    ? '(whole response — single event)'
                    : currentEventPath || '(not set — choose a candidate or whole response)'}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">
                  event_root_path: {currentEventRootPath || '(not set)'}
                </p>
              </div>
            </div>
          </PanelChrome>

          <PanelChrome title="Suggested checkpoint fields">
            <div className="p-3 space-y-3">
              <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
                Pick a field to track progress (TIMESTAMP, ID, CURSOR, OFFSET). You can override manually — values are relative to one event when an
                array is selected.
              </p>
              {checkpointCandidates.length === 0 ? (
                <p className="text-[11px] italic text-slate-500 dark:text-gdc-muted">No obvious checkpoint fields; set manually if needed.</p>
              ) : (
                <ul className="space-y-2">
                  {checkpointCandidates.map((c) => {
                    const sel =
                      state.stream.checkpointSourcePath === c.path && state.stream.checkpointFieldType === c.checkpoint_type
                    return (
                      <li key={`${c.path}-${c.checkpoint_type}`}>
                        <button
                          type="button"
                          onClick={() =>
                            onSetCheckpoint({
                              checkpointFieldType: c.checkpoint_type as WizardCheckpointFieldType,
                              checkpointSourcePath: c.path,
                            })
                          }
                          className={cn(
                            'flex w-full flex-col rounded-md border px-2 py-1.5 text-left text-[11px]',
                            sel
                              ? 'border-violet-500/60 bg-violet-500/[0.08] text-violet-950 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-50'
                              : 'border-slate-200/90 bg-white text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover',
                          )}
                        >
                          <span className="font-mono text-[11px]">{c.path}</span>
                          <span
                            className={cn(
                              'text-[10px]',
                              sel ? 'text-violet-900 dark:text-violet-200' : 'text-slate-600 dark:text-slate-300',
                            )}
                          >
                            {c.checkpoint_type} · {(c.confidence * 100).toFixed(0)}% — {c.reason}
                          </span>
                          <span
                            className={cn(
                              'truncate text-[10px]',
                              sel ? 'text-violet-800 dark:text-violet-300/90' : 'text-slate-500 dark:text-slate-400',
                            )}
                          >
                            Sample: {String(c.sample_value)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Type override
                  <select
                    value={state.stream.checkpointFieldType}
                    onChange={(e) =>
                      onSetCheckpoint({
                        checkpointFieldType: e.target.value as WizardCheckpointFieldType,
                      })
                    }
                    className="mt-1 h-8 w-full rounded border border-slate-200/90 bg-white px-1.5 text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                  >
                    <option value="">(not set)</option>
                    <option value="TIMESTAMP">TIMESTAMP</option>
                    <option value="EVENT_ID">EVENT_ID</option>
                    <option value="CURSOR">CURSOR</option>
                    <option value="OFFSET">OFFSET</option>
                  </select>
                </label>
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Path override
                  <input
                    value={state.stream.checkpointSourcePath}
                    onChange={(e) => onSetCheckpoint({ checkpointSourcePath: e.target.value })}
                    placeholder="$.creationTime"
                    className="mt-1 h-8 w-full rounded border border-slate-200/90 bg-white px-2 font-mono text-[11px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </label>
              </div>
            </div>
          </PanelChrome>
        </div>
      </div>

    </section>
  )
}
