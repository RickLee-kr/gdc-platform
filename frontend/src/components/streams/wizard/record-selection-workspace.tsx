import { AlertTriangle, Check, Copy, Hash, ListTree, Search, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import { copyTextToClipboard } from '../../../utils/clipboard'
import {
  absolutePathInSampleRecord,
  approxJsonBytes,
  checkpointPathFromClick,
  eventRootPathFromClick,
  formatPreviewSamplePath,
  normalizeEventArrayPath,
} from '../../../utils/eventExtractionPaths'
import {
  deriveRecordSelectionPaths,
  eventArrayPathFromClick,
  recordSelectionSummary,
  type RecordSelectionPaths,
} from '../../../utils/recordSelectionPaths'
import { MappingJsonTree, PanelChrome } from '../mapping-json-tree'
import {
  IncrementalRequestTestButton,
  IncrementalRequestTestSection,
  useIncrementalRequestTest,
} from './incremental-request-test-section'
import type { WizardCheckpointFieldType, WizardConfigState, WizardState } from './wizard-state'
import { flattenSampleFields, wizardExtractEvents } from './wizard-json-extract'
import type { OperationalSampleId } from './wizard-operational-samples'
import {
  buildIncrementalRequestPlan,
  fieldNameFromCheckpointPath,
  looksLikeQueryParams,
  readCheckpointSampleValue,
  sampleValueTypeLabel,
  type IncrementalRequestPattern,
} from './wizard-incremental-request'

type RecordSelectionWorkspaceProps = {
  state: WizardState
  onSetEventArrayPath: (path: string) => void
  onSetEventRootPath: (path: string) => void
  onSetCheckpoint: (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => void
  onStreamPatch?: (patch: Partial<WizardConfigState>) => void
  onLoadOperationalSample?: (id: OperationalSampleId) => void
  activeOperationalSampleId?: OperationalSampleId | null
}

type ExtractedViewMode = 'fields' | 'json'
type SourceViewMode = 'json' | 'tree'

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function collectArrayPaths(
  value: unknown,
  base: string,
  out: Array<{ path: string; count: number; sample?: unknown }>,
): void {
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

function fieldRowsFromObject(obj: Record<string, unknown> | null, max = 120): Array<{ key: string; path: string; value: unknown }> {
  if (!obj) return []
  const paths = flattenSampleFields(obj, max, 6)
  return paths.map((path) => {
    const key = path.replace(/^\$\.?/, '')
    let value: unknown = obj
    for (const part of key.split('.')) {
      if (value == null || typeof value !== 'object') break
      value = (value as Record<string, unknown>)[part]
    }
    return { key, path, value }
  })
}

export function RecordSelectionWorkspace({
  state,
  onSetEventArrayPath,
  onSetEventRootPath,
  onSetCheckpoint,
  onStreamPatch,
}: RecordSelectionWorkspaceProps) {
  const t = state.apiTest
  const analysis = t.analysis
  const [search, setSearch] = useState('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [extractedView, setExtractedView] = useState<ExtractedViewMode>('fields')
  const [sourceView, setSourceView] = useState<SourceViewMode>('tree')
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  /** True once user has clicked an "Event Root" pill — keeps the status chip activated even when the
   *  normalized path resolves to '' (entire record), which would otherwise look identical to the default. */
  const [eventRootInteracted, setEventRootInteracted] = useState(false)

  const rawPayload = t.parsedJson ?? t.rawResponse

  const pathsFromProps = useMemo(
    () =>
      deriveRecordSelectionPaths(
        state.stream.eventArrayPath,
        state.stream.eventRootPath,
        state.stream.checkpointSourcePath,
        state.stream.useWholeResponseAsEvent,
        rawPayload,
      ),
    [
      rawPayload,
      state.stream.checkpointSourcePath,
      state.stream.eventArrayPath,
      state.stream.eventRootPath,
      state.stream.useWholeResponseAsEvent,
    ],
  )

  const [paths, setPaths] = useState<RecordSelectionPaths>(pathsFromProps)

  useEffect(() => {
    setPaths(pathsFromProps)
  }, [pathsFromProps])

  const extractedEvents = useMemo(
    () => wizardExtractEvents(rawPayload, paths.eventArrayPath, paths.eventRootPath),
    [rawPayload, paths.eventArrayPath, paths.eventRootPath],
  )

  /** Event Source records only — checkpoint test values ignore Event Root. */
  const eventSourceRecords = useMemo(
    () => wizardExtractEvents(rawPayload, paths.eventArrayPath, ''),
    [rawPayload, paths.eventArrayPath],
  )

  const previewIndexClamped = Math.min(Math.max(0, previewIndex), Math.max(0, extractedEvents.length - 1))
  const extractedPreview = extractedEvents[previewIndexClamped] ?? null

  const summary = useMemo(
    () => recordSelectionSummary(paths, extractedEvents.length, previewIndexClamped),
    [extractedEvents.length, paths, previewIndexClamped],
  )

  // Backend recommendation data is still computed (used for candidate dropdowns) — UI banners removed.
  const arrayCandidates = useMemo(() => {
    if (analysis?.detectedArrays?.length) {
      return analysis.detectedArrays.map((a) => ({
        path: normalizeEventArrayPath(a.path),
        count: a.count,
      }))
    }
    if (!rawPayload) return []
    const out: Array<{ path: string; count: number }> = []
    collectArrayPaths(rawPayload, '$', out)
    return out
  }, [analysis?.detectedArrays, rawPayload])

  const fieldRows = useMemo(() => fieldRowsFromObject(extractedPreview), [extractedPreview])
  const approxBytes = approxJsonBytes(rawPayload)
  const extractedBytes = approxJsonBytes(extractedPreview)

  const notifyCopy = useCallback((label: string) => {
    setCopyNotice(label)
    window.setTimeout(() => setCopyNotice(null), 2000)
  }, [])

  const copyValue = useCallback(
    async (text: string, label: string) => {
      const ok = await copyTextToClipboard(text)
      notifyCopy(ok ? label : 'Copy failed — check browser permissions')
    },
    [notifyCopy],
  )

  const handleSelectEventArray = useCallback(
    (clickedPath: string) => {
      const normalized = eventArrayPathFromClick(clickedPath, rawPayload)
      const nextPaths: RecordSelectionPaths = { ...paths, eventArrayPath: normalized }
      setPaths(nextPaths)
      setPreviewIndex(0)
      onSetEventArrayPath(normalized)
      // Event Source change resets the Event Root interaction (the new array element may differ).
      setEventRootInteracted(false)
      notifyCopy(`Event source → ${normalized || '$'}`)
    },
    [notifyCopy, onSetEventArrayPath, paths, rawPayload],
  )

  const handleSelectEventRoot = useCallback(
    (clickedPath: string) => {
      const normalized = eventRootPathFromClick(clickedPath, paths.eventArrayPath || '$')
      const nextPaths: RecordSelectionPaths = { ...paths, eventRootPath: normalized }
      setPaths(nextPaths)
      setPreviewIndex(0)
      onSetEventRootPath(normalized)
      setEventRootInteracted(true)
      notifyCopy(`Event root → ${normalized || '(entire record)'}`)
    },
    [notifyCopy, onSetEventRootPath, paths],
  )

  const handleSelectCheckpoint = useCallback(
    (absolutePath: string, type?: WizardCheckpointFieldType) => {
      const rel = checkpointPathFromClick(absolutePath, paths.eventArrayPath, previewIndexClamped)
      const nextPaths: RecordSelectionPaths = { ...paths, checkpointSourcePath: rel }
      setPaths(nextPaths)
      onSetCheckpoint({
        checkpointSourcePath: rel,
        ...(type ? { checkpointFieldType: type } : {}),
      })
      notifyCopy(`Checkpoint → ${rel || '(cleared)'}`)
    },
    [onSetCheckpoint, paths, previewIndexClamped, notifyCopy],
  )

  const eventSourceHighlight =
    paths.eventArrayPath && paths.eventArrayPath !== '$' ? paths.eventArrayPath : paths.eventArrayPath === '$' ? '$' : null
  const eventRootHighlight = paths.eventRootPath
    ? absolutePathInSampleRecord(paths.eventArrayPath, paths.eventRootPath, previewIndexClamped)
    : null
  const checkpointHighlight = paths.checkpointSourcePath
    ? absolutePathInSampleRecord(paths.eventArrayPath, paths.checkpointSourcePath, previewIndexClamped)
    : null

  if (t.status !== 'success' || rawPayload == null) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Record Selection</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Run <span className="font-semibold">Fetch Sample Data</span> or load an operational test dataset on the API Test step.
        </p>
      </section>
    )
  }

  return (
    <section id="wizard-json-preview-panel" className="space-y-3" tabIndex={-1}>
      {copyNotice ? (
        <p className="rounded-md border border-emerald-200/80 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200">
          {copyNotice}
        </p>
      ) : null}

      {/* Hidden testId-only summary anchors retained for existing tests/integrations. */}
      <div className="sr-only" aria-hidden>
        <span data-testid="summary-event-source">{summary.eventSource}</span>
        <span data-testid="summary-event-root">{summary.eventRoot}</span>
        <span data-testid="summary-runtime">{summary.runtimeExtraction}</span>
        <span data-testid="summary-records">{summary.recordsDetected}</span>
        <span data-testid="summary-preview">{summary.previewSample}</span>
      </div>

      {/*
       * Unified workspace header: page title + description moved here (was a
       * separate top-level row); SelectionStatusChips share the same row on the
       * right; detected extraction candidates moved to a dedicated strip below.
       * The "API-backed" and "X records" page-header badges were intentionally
       * removed — the records count is already surfaced by SelectionStatusChips
       * and the API-backed origin is implicit once the user reaches this step.
       */}
      <div className="rounded-lg border border-violet-300/60 bg-white p-2.5 ring-1 ring-violet-500/10 dark:border-violet-500/40 dark:bg-gdc-card dark:ring-violet-400/10">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Record Selection</h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-300/80 bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100">
                Required setup
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-gdc-muted">
              Select the repeating record array and checkpoint field before proceeding to Mapping. Event Root is optional.
              Preview uses sample index <span className="font-mono">{previewIndexClamped}</span> only — runtime extracts all records.
            </p>
          </div>
          <SelectionStatusChips
            eventArrayPath={paths.eventArrayPath}
            eventRootPath={paths.eventRootPath}
            eventRootInteracted={eventRootInteracted}
            recordsCount={extractedEvents.length}
            checkpointPath={state.stream.checkpointSourcePath}
            checkpointType={state.stream.checkpointFieldType}
          />
        </div>

        {(() => {
          const eventSourceMissing =
            !state.stream.useWholeResponseAsEvent && paths.eventArrayPath.trim().length === 0
          const checkpointMissing = state.stream.checkpointSourcePath.trim().length === 0
          if (!eventSourceMissing && !checkpointMissing) return null
          const missing: string[] = []
          if (eventSourceMissing) missing.push('Event Source')
          if (checkpointMissing) missing.push('Checkpoint')
          return (
            <div
              role="status"
              className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">Next is blocked.</span> Select {missing.join(' and ')} below — Mapping cannot start
                without {missing.length > 1 ? 'these fields' : 'this field'}.
              </span>
            </div>
          )
        })()}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2 dark:border-gdc-border">
          <p className="mr-1 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
            Detected extraction candidates
          </p>
          {arrayCandidates.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {arrayCandidates.slice(0, 8).map((c, idx) => {
                const selected = paths.eventArrayPath === c.path
                const recommended = idx === 0
                return (
                  <li key={c.path}>
                    <button
                      type="button"
                      onClick={() => handleSelectEventArray(c.path)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                        selected
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-slate-200/90 bg-white hover:border-violet-300 hover:bg-violet-50 dark:border-gdc-border dark:bg-gdc-elevated dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex h-2 w-2 rounded-full',
                          recommended ? 'bg-emerald-500' : 'bg-slate-400',
                        )}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'font-mono',
                          selected ? 'text-white' : 'text-slate-800 dark:text-slate-100',
                        )}
                      >
                        {c.path}
                      </span>
                      <span className={cn(selected ? 'text-violet-100' : 'text-slate-500 dark:text-gdc-mutedStrong')}>
                        · {c.count} {c.count === 1 ? 'event' : 'events'}
                      </span>
                      {recommended ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                            selected
                              ? 'border-white/40 bg-white/10 text-white'
                              : 'border-emerald-300/80 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-200',
                          )}
                        >
                          ★ Recommended
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <span className="text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
              No event arrays detected — use tree below to set Event Root or Checkpoint.
            </span>
          )}
        </div>
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        {/* Left tree column — its natural height is decoupled from the grid row via absolute
            positioning, so the row height is dictated by the right column. The tree scrolls
            internally with a thin/transparent scrollbar instead of stretching the page. */}
        <div className="relative min-h-[720px]">
        <PanelChrome
          title={sourceView === 'json' ? 'Formatted JSON' : 'Tree (click row to copy JSONPath · use as Event Array / Event Root)'}
          className="gdc-panel-thin absolute inset-0 !max-h-none"
          right={
            <div className="flex items-center gap-2">
              {sourceView === 'tree' ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter paths…"
                    className="h-7 w-40 rounded border border-slate-200/90 bg-white py-1 pl-7 pr-2 text-[11px] text-slate-800 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-gdc-placeholder"
                  />
                </div>
              ) : (
                <span className="text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{approxBytes.toLocaleString()} bytes</span>
              )}
              <button
                type="button"
                onClick={() => void copyValue(formatJson(rawPayload), 'Raw JSON copied')}
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                title="Copy raw JSON"
              >
                <Copy className="h-3 w-3" aria-hidden />
                Copy
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSourceView('json')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sourceView === 'json'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-gdc-rowHover',
                  )}
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => setSourceView('tree')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sourceView === 'tree'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-gdc-rowHover',
                  )}
                >
                  Tree
                </button>
              </div>
            </div>
          }
        >
          {sourceView === 'json' ? (
            <pre className="gdc-thin-scroll overflow-x-auto rounded-md bg-slate-950 p-3 text-[10px] leading-snug text-emerald-200">
              {formatJson(rawPayload)}
            </pre>
          ) : (
            <div className="p-2">
              {typeof rawPayload === 'object' && rawPayload !== null ? (
                <MappingJsonTree
                  value={rawPayload}
                  baseLabel="root"
                  basePath="$"
                  search={search}
                  highlightPathPrefix={eventSourceHighlight}
                  eventRootHighlightPath={eventRootHighlight}
                  checkpointHighlightPath={checkpointHighlight}
                  expandStrategy="smart"
                  onPickPath={(p) => handleSelectCheckpoint(p)}
                  onUseEventArrayPath={handleSelectEventArray}
                  onUseEventRootPath={handleSelectEventRoot}
                  onUseCheckpointPath={handleSelectCheckpoint}
                />
              ) : (
                <p className="text-[11px] text-slate-500">Tree view requires a JSON object or array.</p>
              )}
            </div>
          )}
        </PanelChrome>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
        <PanelChrome
          title="Extracted event preview"
          className="!max-h-none overflow-visible [&>div:last-child]:overflow-visible"
          right={
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
                {paths.eventArrayPath || '$'}
                {paths.eventRootPath ? ` · root: ${paths.eventRootPath}` : ''}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExtractedView('fields')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    extractedView === 'fields'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-gdc-rowHover',
                  )}
                >
                  Fields
                </button>
                <button
                  type="button"
                  onClick={() => setExtractedView('json')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    extractedView === 'json'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-gdc-rowHover',
                  )}
                >
                  JSON
                </button>
              </div>
            </div>
          }
        >
          {extractedPreview == null ? (
            <p className="p-3 text-[11px] text-amber-800 dark:text-amber-200">
              No extracted events — pick an event array path (or click <span className="font-semibold">Use as Event Array</span> on a tree row).
            </p>
          ) : (
            <div className="p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Sample
                  <select
                    value={previewIndexClamped}
                    onChange={(e) => setPreviewIndex(Number(e.target.value))}
                    className="ml-1 h-7 rounded border border-slate-200/90 px-1 font-mono text-[10px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:[color-scheme:dark]"
                  >
                    {extractedEvents.map((_, i) => (
                      <option key={i} value={i}>
                        {formatPreviewSamplePath(paths.eventArrayPath || '$', i)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void copyValue(formatJson(extractedPreview), 'Extracted event JSON copied')}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  Copy
                </button>
              </div>
              {extractedView === 'json' ? (
                <>
                  <pre className="gdc-thin-scroll overflow-x-auto rounded-md border border-slate-200/80 bg-slate-950 p-3 text-[10px] text-emerald-200">
                    {formatJson(extractedPreview)}
                  </pre>
                  <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
                    ~{extractedBytes.toLocaleString()} bytes · {fieldRows.length} fields
                  </p>
                </>
              ) : (
                <div className="rounded-md border border-slate-200/80 dark:border-gdc-border">
                  <table className="w-full text-left text-[10px]">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-gdc-section">
                      <tr>
                        <th className="px-2 py-1 font-semibold text-slate-600 dark:text-gdc-mutedStrong">Field</th>
                        <th className="px-2 py-1 font-semibold text-slate-600 dark:text-gdc-mutedStrong">Value</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {fieldRows.map((row) => (
                        <tr key={row.path} className="group border-t border-slate-100 dark:border-gdc-border">
                          <td className="px-2 py-1 font-mono text-violet-800 dark:text-violet-200">{row.key}</td>
                          <td className="max-w-[200px] truncate px-2 py-1 text-slate-700 dark:text-slate-200">
                            {truncate(String(row.value ?? '—'), 64)}
                          </td>
                          <td className="px-1 py-1 opacity-0 group-hover:opacity-100">
                            <div className="flex gap-0.5">
                              <button
                                type="button"
                                title="Copy path"
                                onClick={() => void copyValue(row.path, 'Path copied')}
                                className="rounded border border-slate-200/90 bg-white px-1 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                              >
                                <ListTree className="h-3 w-3" aria-hidden />
                              </button>
                              <button
                                type="button"
                                title="Copy value"
                                onClick={() => void copyValue(formatJson(row.value), 'Value copied')}
                                className="rounded border border-slate-200/90 bg-white px-1 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                              >
                                <Hash className="h-3 w-3" aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </PanelChrome>

        <IncrementalRequestPanel
          state={state}
          eventSourceRecords={eventSourceRecords}
          eventArrayPath={paths.eventArrayPath}
          checkpointSourcePath={paths.checkpointSourcePath}
          checkpointFieldType={state.stream.checkpointFieldType}
          extractedPreview={extractedPreview}
          pattern={state.stream.incrementalRequestPattern}
          draft={state.stream.incrementalRequestDraft}
          onChange={(patch) => onStreamPatch?.(patch)}
          onClearCheckpoint={() => onSetCheckpoint({ checkpointSourcePath: '', checkpointFieldType: '' })}
          onCopy={(text) => void copyValue(text, 'Request template copied')}
        />
        </div>
      </div>

    </section>
  )
}

function SelectionStatusChips({
  eventArrayPath,
  eventRootPath,
  eventRootInteracted,
  recordsCount,
  checkpointPath,
  checkpointType,
}: {
  eventArrayPath: string
  eventRootPath: string
  eventRootInteracted: boolean
  recordsCount: number
  checkpointPath: string
  checkpointType: string
}) {
  const eventSourceSelected = Boolean(eventArrayPath)
  // Show as 'ok' whenever the user has explicitly clicked an Event Root pill, even if the
  // normalized path is empty (== "entire record"). Otherwise treat empty path as default/idle.
  const eventRootActive = Boolean(eventRootPath) || eventRootInteracted
  const checkpointSelected = Boolean(checkpointPath)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
      <StatusChip
        label="Event Source"
        value={eventArrayPath || 'Not selected'}
        tone={eventSourceSelected ? 'ok' : 'idle'}
      />
      <StatusChip
        label="Event Root"
        value={eventRootPath ? eventRootPath : eventRootInteracted ? '(entire record)' : 'Not selected'}
        tone={eventRootActive ? 'ok' : 'idle'}
      />
      <StatusChip
        label={recordsCount === 1 ? 'record' : 'records'}
        value={String(recordsCount)}
        tone="info"
        reverse
      />
      <StatusChip
        label="Checkpoint"
        value={checkpointSelected ? `${checkpointPath}${checkpointType ? ` · ${checkpointType}` : ''}` : 'Not selected'}
        tone={checkpointSelected ? 'ok' : 'idle'}
      />
    </div>
  )
}

function StatusChip({
  label,
  value,
  tone,
  reverse,
}: {
  label: string
  value: string
  tone: 'ok' | 'idle' | 'info'
  reverse?: boolean
}) {
  const toneClasses = {
    ok: 'border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/40 dark:border-emerald-400 dark:bg-emerald-500/25 dark:text-emerald-50 dark:ring-emerald-400/40',
    idle: 'border-slate-200/90 bg-slate-50 text-slate-600 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-mutedStrong',
    info: 'border-slate-200/90 bg-white text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
  }[tone]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5', toneClasses)}>
      {tone === 'ok' ? (
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-300" aria-hidden />
      ) : (
        <span
          className={cn(
            'inline-flex h-1.5 w-1.5 rounded-full',
            tone === 'info' ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-500',
          )}
          aria-hidden
        />
      )}
      {reverse ? (
        <>
          <span className="font-semibold">{value}</span>
          <span className="text-[10px] opacity-80">{label}</span>
        </>
      ) : (
        <>
          <span className="text-[10px] uppercase tracking-wide opacity-75">{label}</span>
          <span className={cn('font-mono', tone === 'idle' ? '' : 'font-semibold')}>{value}</span>
        </>
      )}
    </span>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

const PATTERN_OPTIONS: Array<{ value: IncrementalRequestPattern; label: string; subtitle: string }> = [
  { value: 'none', label: 'None', subtitle: 'Do not modify the HTTP Request' },
  { value: 'custom', label: 'Custom', subtitle: 'Write your own template (JSON body or query string)' },
  { value: 'query_params', label: 'Query Parameters (GET)', subtitle: 'Add as query params' },
  { value: 'json_body', label: 'JSON Body Filter', subtitle: 'Add as JSON body' },
  { value: 'elasticsearch', label: 'Elasticsearch / Stellar Search', subtitle: 'Use range query in search body' },
]

function previewLabel(pattern: IncrementalRequestPattern, draft: string): string {
  if (pattern === 'query_params') return 'Query Params'
  if (pattern === 'json_body' || pattern === 'elasticsearch') return 'JSON Body'
  if (pattern === 'custom') return looksLikeQueryParams(draft) ? 'Query Params' : 'JSON Body'
  return '—'
}

function IncrementalRequestPanel({
  state,
  eventSourceRecords,
  eventArrayPath,
  checkpointSourcePath,
  checkpointFieldType,
  extractedPreview,
  pattern,
  draft,
  onChange,
  onClearCheckpoint,
  onCopy,
}: {
  state: WizardState
  eventSourceRecords: Array<Record<string, unknown>>
  eventArrayPath: string
  checkpointSourcePath: string
  checkpointFieldType: WizardCheckpointFieldType
  extractedPreview: Record<string, unknown> | null
  pattern: IncrementalRequestPattern
  draft: string
  onChange: (patch: Partial<WizardConfigState>) => void
  onClearCheckpoint: () => void
  onCopy: (text: string) => void
}) {
  const { testing, testDisabled, runTest } = useIncrementalRequestTest({
    state,
    eventSourceRecords,
    eventArrayPath,
    checkpointSourcePath,
    checkpointFieldType,
    pattern,
    draft,
    onStreamPatch: onChange,
  })
  const fieldFull = fieldNameFromCheckpointPath(checkpointSourcePath)
  const hasCheckpoint = Boolean(fieldFull)
  const sampleValue = useMemo(
    () => (hasCheckpoint ? readCheckpointSampleValue(extractedPreview, checkpointSourcePath) : undefined),
    [extractedPreview, checkpointSourcePath, hasCheckpoint],
  )
  const detectedTypeLabel = checkpointFieldType || sampleValueTypeLabel(sampleValue)

  const generated = useMemo(
    () => buildIncrementalRequestPlan(pattern, checkpointSourcePath),
    [pattern, checkpointSourcePath],
  )

  // Auto-fill the draft when the user picks a non-custom pattern with a valid checkpoint, but
  // only when the current draft is empty / matches a known generated template — don't clobber
  // edits the operator has already made.
  useEffect(() => {
    if (pattern === 'none') {
      if (draft !== '') onChange({ incrementalRequestDraft: '' })
      return
    }
    if (pattern === 'custom') return
    const next = generated?.preview ?? ''
    if (!draft && next) onChange({ incrementalRequestDraft: next })
  }, [pattern, generated, draft, onChange])

  const setPattern = useCallback(
    (next: IncrementalRequestPattern) => {
      const generatedNext = buildIncrementalRequestPlan(next, checkpointSourcePath)
      const patch: Partial<WizardConfigState> = { incrementalRequestPattern: next }
      if (next === 'none') {
        patch.incrementalRequestDraft = ''
      } else if (next !== 'custom') {
        patch.incrementalRequestDraft = generatedNext?.preview ?? ''
      }
      onChange(patch)
    },
    [checkpointSourcePath, onChange],
  )

  const setDraft = useCallback(
    (next: string) => onChange({ incrementalRequestDraft: next }),
    [onChange],
  )

  const generateDisabled = !hasCheckpoint && pattern !== 'custom' && pattern !== 'none'
  const activeOption = PATTERN_OPTIONS.find((o) => o.value === pattern) ?? PATTERN_OPTIONS[0]

  return (
    <div className="flex flex-col rounded-lg border border-slate-200/80 bg-white p-2.5 dark:border-gdc-border dark:bg-gdc-card">
      <div className="flex shrink-0 items-center gap-2">
        <Wand2 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" aria-hidden />
        <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Generate incremental request</h4>
      </div>

      <div className="mt-2 rounded-md border border-slate-200/70 bg-slate-50/70 p-2 dark:border-gdc-border dark:bg-gdc-elevated">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <NumberBadge n={1} />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Selected checkpoint field</p>
          </div>
          {hasCheckpoint ? (
            <button
              type="button"
              onClick={onClearCheckpoint}
              className="inline-flex h-6 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              title="Clear the checkpoint to pick a different field from the tree"
            >
              Change field
            </button>
          ) : null}
        </div>
        {hasCheckpoint ? (
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
            <KvCell label="Field" value={fieldFull} mono />
            <KvCell label="Type" value={detectedTypeLabel || '—'} />
            <KvCell label="Example" value={formatSample(sampleValue)} mono />
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-gdc-mutedStrong">
            Pick a checkpoint by clicking the bookmark icon on any leaf row in the tree (or choose <span className="font-semibold">Custom</span> below to write a template manually).
          </p>
        )}
      </div>

      <div className="mt-2 rounded-md border border-slate-200/70 p-2 dark:border-gdc-border">
        <div className="flex flex-wrap items-center gap-2">
          <NumberBadge n={2} />
          <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Generate incremental request</p>
          <select
            value={pattern}
            onChange={(e) => setPattern(e.target.value as IncrementalRequestPattern)}
            className="ml-auto h-7 max-w-full rounded border border-slate-200/90 bg-white px-2 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:[color-scheme:dark]"
            aria-label="Pattern"
          >
            {PATTERN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {generateDisabled ? (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
            Pick a checkpoint field first, or switch to <span className="font-semibold">Custom</span>.
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{activeOption.subtitle}</p>
        )}
      </div>

      <div className="mt-2 rounded-md border border-slate-200/70 p-2 dark:border-gdc-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <NumberBadge n={3} />
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
              Request preview ({previewLabel(pattern, draft)})
            </p>
            {pattern !== 'none' ? (
              <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold uppercase text-slate-600 dark:bg-gdc-elevated dark:text-gdc-mutedStrong">
                editable
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {pattern !== 'none' ? (
              <IncrementalRequestTestButton testing={testing} disabled={testDisabled} onClick={() => void runTest()} />
            ) : null}
            {pattern !== 'none' && pattern !== 'custom' ? (
              <button
                type="button"
                onClick={() => setDraft(generated?.preview ?? '')}
                disabled={!generated}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                title="Reset preview back to the auto-generated template"
              >
                Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onCopy(draft)}
              disabled={!draft}
              className="inline-flex h-6 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              <Copy className="h-3 w-3" aria-hidden />
              Copy
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          disabled={pattern === 'none'}
          placeholder={
            pattern === 'none'
              ? '// Select a pattern above to get started.'
              : pattern === 'custom'
              ? '// Custom template — paste any JSON body or write `key=value` lines for query params.\n// You can use {{checkpoint.last_timestamp}}, {{now}}, {{checkpoint.last_id}}.'
              : '// Pick a checkpoint field to populate this template.'
          }
          className="gdc-thin-scroll mt-1.5 block min-h-[200px] w-full resize-y rounded-md border border-slate-200/80 bg-slate-950 p-2 font-mono text-[10px] leading-snug text-emerald-200 placeholder:text-emerald-200/40 disabled:opacity-50 dark:border-gdc-border"
        />
        <IncrementalRequestTestSection
          state={state}
          eventSourceRecords={eventSourceRecords}
          eventArrayPath={eventArrayPath}
          checkpointSourcePath={checkpointSourcePath}
          checkpointFieldType={checkpointFieldType}
          pattern={pattern}
          draft={draft}
          onStreamPatch={onChange}
        />
        <p className="mt-1.5 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
          Incremental request template will be applied automatically when the stream is created. The saved stream keeps
          template placeholders — only the Test call substitutes checkpoint values.
        </p>
      </div>
    </div>
  )
}

function NumberBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white">
      {n}
    </span>
  )
}

function KvCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-mutedStrong">{label}</p>
      <p
        className={cn(
          'truncate text-[11px] text-slate-800 dark:text-slate-100',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value || '—'}
      </p>
    </div>
  )
}

function formatSample(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const s = JSON.stringify(value)
    return s.length > 48 ? `${s.slice(0, 48)}…` : s
  } catch {
    return String(value)
  }
}

