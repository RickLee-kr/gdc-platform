import {
  Check,
  CheckCircle2,
  Copy,
  Hash,
  Layers,
  ListTree,
  Search,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import { copyTextToClipboard } from '../../../utils/clipboard'
import {
  absolutePathInSampleRecord,
  approxJsonBytes,
  checkpointPathFromClick,
  eventRootPathFromClick,
  formatCheckpointAppliesTo,
  formatPreviewSamplePath,
  isPreviewOnlyArrayPath,
  normalizeEventArrayPath,
} from '../../../utils/eventExtractionPaths'
import {
  deriveRecordSelectionPaths,
  eventArrayPathFromClick,
  recordSelectionSummary,
  type RecordSelectionPaths,
} from '../../../utils/recordSelectionPaths'
import { MappingJsonTree, PanelChrome } from '../mapping-json-tree'
import { HelpTooltip } from '../../ui/help-tooltip'
import { HELP_COPY } from '../../ui/help-tooltip-copy'
import {
  CheckpointExtractionSuggestionsPanel,
  type CheckpointExtractionApplyHandlers,
} from '../checkpoint-extraction-suggestions-panel'
import { mergeSortIntoRequestBody } from '../checkpoint-extraction-suggestions'
import type { WizardCheckpointFieldType, WizardConfigState, WizardState } from './wizard-state'
import { detectEventRootCandidates, flattenSampleFields, wizardExtractEvents } from './wizard-json-extract'
import {
  OPERATIONAL_SAMPLES,
  type OperationalSampleId,
} from './wizard-operational-samples'

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
  onLoadOperationalSample,
  activeOperationalSampleId,
}: RecordSelectionWorkspaceProps) {
  const t = state.apiTest
  const analysis = t.analysis
  const [search, setSearch] = useState('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [extractedView, setExtractedView] = useState<ExtractedViewMode>('fields')
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const [summaryPulse, setSummaryPulse] = useState<'eventSource' | 'eventRoot' | 'runtime' | 'records' | 'preview' | null>(null)

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

  const previewIndexClamped = Math.min(Math.max(0, previewIndex), Math.max(0, extractedEvents.length - 1))
  const extractedPreview = extractedEvents[previewIndexClamped] ?? null

  const summary = useMemo(
    () => recordSelectionSummary(paths, extractedEvents.length, previewIndexClamped),
    [extractedEvents.length, paths, previewIndexClamped],
  )

  const arrayCandidates = useMemo(() => {
    if (analysis?.detectedArrays?.length) {
      return analysis.detectedArrays.map((a) => ({
        path: normalizeEventArrayPath(a.path),
        count: a.count,
        confidence: a.confidence,
        reason: a.reason,
      }))
    }
    if (!rawPayload) return []
    const out: Array<{ path: string; count: number; confidence?: number; reason?: string }> = []
    collectArrayPaths(rawPayload, '$', out)
    return out.map((o) => ({ ...o, confidence: 0.5, reason: 'Heuristic scan' }))
  }, [analysis?.detectedArrays, rawPayload])

  const eventRootCandidates = useMemo(() => {
    if (analysis?.eventRootCandidates?.length) return analysis.eventRootCandidates
    const firstRecord = wizardExtractEvents(rawPayload, paths.eventArrayPath, '')[0] ?? null
    return detectEventRootCandidates(firstRecord)
  }, [analysis?.eventRootCandidates, rawPayload, paths.eventArrayPath])

  const checkpointCandidates = analysis?.detectedCheckpointCandidates ?? []
  const fieldRows = useMemo(() => fieldRowsFromObject(extractedPreview), [extractedPreview])
  const approxBytes = approxJsonBytes(rawPayload)
  const extractedBytes = approxJsonBytes(extractedPreview)

  const notifyCopy = useCallback((label: string) => {
    setCopyNotice(label)
    window.setTimeout(() => setCopyNotice(null), 2000)
  }, [])

  const pulseSummary = useCallback((key: typeof summaryPulse) => {
    setSummaryPulse(key)
    window.setTimeout(() => setSummaryPulse(null), 1200)
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
      if (isPreviewOnlyArrayPath(clickedPath)) {
        notifyCopy(`Event source → ${normalized} (index stripped from ${clickedPath})`)
      } else {
        notifyCopy(`Event source → ${normalized || '$'}`)
      }
      pulseSummary('eventSource')
      pulseSummary('records')
      pulseSummary('runtime')
      pulseSummary('preview')
    },
    [notifyCopy, onSetEventArrayPath, paths, pulseSummary, rawPayload],
  )

  const handleSelectEventRoot = useCallback(
    (clickedPath: string) => {
      const normalized = eventRootPathFromClick(clickedPath, paths.eventArrayPath || '$')
      const nextPaths: RecordSelectionPaths = { ...paths, eventRootPath: normalized }
      setPaths(nextPaths)
      setPreviewIndex(0)
      onSetEventRootPath(normalized)
      notifyCopy(`Event root → ${normalized || '(entire record)'}`)
      pulseSummary('eventRoot')
      pulseSummary('runtime')
      pulseSummary('records')
      pulseSummary('preview')
    },
    [notifyCopy, onSetEventRootPath, paths, pulseSummary],
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
      pulseSummary('runtime')
    },
    [onSetCheckpoint, paths, previewIndexClamped, pulseSummary, notifyCopy],
  )

  const applyTopSuggestion = () => {
    const top = arrayCandidates[0]
    if (!top) return
    handleSelectEventArray(top.path)
    const sample = activeOperationalSampleId
      ? OPERATIONAL_SAMPLES.find((s) => s.id === activeOperationalSampleId)
      : null
    if (sample?.defaultEventRootPath) {
      onSetEventRootPath(sample.defaultEventRootPath)
    }
  }

  const eventSourceHighlight =
    paths.eventArrayPath && paths.eventArrayPath !== '$' ? paths.eventArrayPath : paths.eventArrayPath === '$' ? '$' : null
  const eventRootHighlight = paths.eventRootPath
    ? absolutePathInSampleRecord(paths.eventArrayPath, paths.eventRootPath, previewIndexClamped)
    : null
  const checkpointHighlight = paths.checkpointSourcePath
    ? absolutePathInSampleRecord(paths.eventArrayPath, paths.checkpointSourcePath, previewIndexClamped)
    : null
  const hasEventSource = Boolean(paths.eventArrayPath) || state.stream.useWholeResponseAsEvent

  const suggestionApplyHandlers = useMemo((): CheckpointExtractionApplyHandlers | undefined => {
    if (!rawPayload) return undefined
    return {
      onApplyEventArrayPath: (path) => {
        onSetEventArrayPath(path)
        pulseSummary('eventSource')
      },
      onApplyCheckpointExtraction: ({ checkpointType, extractionPathRelative }) => {
        onSetCheckpoint({
          checkpointFieldType: checkpointType as WizardCheckpointFieldType,
          checkpointSourcePath: extractionPathRelative,
        })
        pulseSummary('runtime')
      },
      onApplySortRecommendation: ({ primaryFieldName, tieBreakerFieldName }) => {
        if (onStreamPatch && primaryFieldName) {
          onStreamPatch({
            requestBody: mergeSortIntoRequestBody(state.stream.requestBody, primaryFieldName),
          })
        }
        if (tieBreakerFieldName && onStreamPatch) {
          // tie-breaker is guidance for request body / checkpoint secondary — keep request body primary sort only
        }
      },
    }
  }, [onSetCheckpoint, onSetEventArrayPath, onStreamPatch, pulseSummary, rawPayload, state.stream.requestBody])

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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Record Selection</h3>
          <p className="text-[12px] text-slate-600 dark:text-gdc-muted">
            Select the repeating record array, optional nested event root, and checkpoint field. Preview uses sample index{' '}
            <span className="font-mono">{previewIndexClamped}</span> only — runtime extracts all records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 font-semibold',
              t.apiBacked
                ? 'border-emerald-200/80 bg-emerald-500/[0.07] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-slate-200 bg-slate-50 dark:border-gdc-border dark:bg-gdc-card',
            )}
          >
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {t.apiBacked ? 'API-backed' : 'Operational sample'}
          </span>
          <span className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200">
            {extractedEvents.length} records
          </span>
        </div>
      </div>

      {onLoadOperationalSample ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-gdc-border dark:bg-gdc-section">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">Test dataset:</span>
          {OPERATIONAL_SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => onLoadOperationalSample(sample.id)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-medium',
                activeOperationalSampleId === sample.id
                  ? 'border-violet-500/60 bg-violet-500/[0.08] text-violet-900 dark:text-violet-100'
                  : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
              )}
            >
              {sample.label}
            </button>
          ))}
        </div>
      ) : null}

      {copyNotice ? (
        <p className="rounded-md border border-emerald-200/80 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200">
          {copyNotice}
        </p>
      ) : null}

      <CheckpointExtractionSuggestionsPanel parsedJson={rawPayload} applyHandlers={suggestionApplyHandlers} />

      {arrayCandidates.length > 0 ? (
        <div className="rounded-lg border border-violet-200/70 bg-violet-500/[0.04] p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Structure detected</p>
              <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
                {arrayCandidates[0]?.reason ?? 'Array of record objects identified'}
                {arrayCandidates[0]?.confidence != null
                  ? ` · ${Math.round(arrayCandidates[0].confidence * 100)}% confidence`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={applyTopSuggestion}
              className="inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700"
            >
              Apply suggestions
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {arrayCandidates.slice(0, 4).map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  onClick={() => handleSelectEventArray(c.path)}
                  className="rounded-md border border-slate-200/90 bg-white px-2 py-1 font-mono text-[10px] text-slate-700 hover:border-violet-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:border-violet-400/60"
                >
                  {c.path} · {c.count} records
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <PanelChrome
          title="Raw Payload"
          className="min-h-[480px]"
          right={
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{approxBytes.toLocaleString()} bytes</span>
              <button
                type="button"
                onClick={() => void copyValue(formatJson(rawPayload), 'Raw JSON copied')}
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
              >
                <Copy className="h-3 w-3" aria-hidden />
                Copy JSON
              </button>
            </div>
          }
        >
          <div className="border-b border-slate-200/70 px-2 py-1.5 dark:border-gdc-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter paths…"
                className="h-7 w-full rounded border border-slate-200/90 bg-white py-1 pl-7 pr-2 text-[11px] text-slate-800 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-gdc-placeholder"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
              Click arrays for event source · objects inside records for event root · fields for checkpoint.
            </p>
          </div>
          <div className="max-h-[min(58vh,640px)] overflow-auto p-2">
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
        </PanelChrome>

        <PanelChrome
          title="Extracted Event Preview"
          className="min-h-[480px]"
          right={
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
          }
        >
          {!hasEventSource ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
              <Layers className="h-8 w-8 text-slate-300" aria-hidden />
              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">No event source selected</p>
              <p className="max-w-xs text-[11px] text-slate-500 dark:text-gdc-mutedStrong">Select an array from the raw payload to extract records.</p>
            </div>
          ) : extractedPreview == null ? (
            <p className="p-4 text-[11px] text-amber-800 dark:text-amber-200">
              No extracted events — check event array path and optional event root.
            </p>
          ) : extractedView === 'json' ? (
            <div className="p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Preview sample
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
                  Copy JSON
                </button>
              </div>
              <pre className="max-h-[min(52vh,600px)] overflow-auto rounded-md border border-slate-200/80 bg-slate-950 p-3 text-[10px] text-emerald-200">
                {formatJson(extractedPreview)}
              </pre>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">~{extractedBytes.toLocaleString()} bytes · {fieldRows.length} fields</p>
            </div>
          ) : (
            <div className="p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  Preview sample
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
              </div>
              <div className="max-h-[min(52vh,600px)] overflow-auto rounded-md border border-slate-200/80 dark:border-gdc-border">
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
            </div>
          )}
        </PanelChrome>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          label="Event Source"
          value={summary.eventSource}
          mono
          pulse={summaryPulse === 'eventSource'}
          testId="summary-event-source"
          help={{ content: HELP_COPY.eventSource.content, example: HELP_COPY.eventSource.example }}
        />
        <SummaryCard
          label="Event Root"
          value={summary.eventRoot}
          mono
          pulse={summaryPulse === 'eventRoot'}
          testId="summary-event-root"
          help={{ content: HELP_COPY.eventRoot.content, example: HELP_COPY.eventRoot.example }}
        />
        <SummaryCard
          label="Runtime Extraction"
          value={summary.runtimeExtraction}
          mono
          pulse={summaryPulse === 'runtime'}
          testId="summary-runtime"
          help={{ content: HELP_COPY.runtimeExtraction.content, example: HELP_COPY.runtimeExtraction.example }}
        />
        <SummaryCard label="Records Detected" value={summary.recordsDetected} pulse={summaryPulse === 'records'} testId="summary-records" />
        <SummaryCard
          label="Preview Sample"
          value={summary.previewSample}
          mono
          pulse={summaryPulse === 'preview'}
          testId="summary-preview"
          help={{ content: HELP_COPY.previewSample.content, example: HELP_COPY.previewSample.example }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <CheckpointPanel
          candidates={checkpointCandidates}
          selectedPath={state.stream.checkpointSourcePath}
          selectedType={state.stream.checkpointFieldType}
          extractedPreview={extractedPreview}
          onSelect={(path, type) => onSetCheckpoint({ checkpointSourcePath: path, checkpointFieldType: type })}
          onClear={() => onSetCheckpoint({ checkpointSourcePath: '', checkpointFieldType: '' })}
          onTypeChange={(type) => onSetCheckpoint({ checkpointFieldType: type })}
          appliesTo={formatCheckpointAppliesTo(paths.eventArrayPath, paths.checkpointSourcePath)}
        />

        <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Event root candidates</p>
          <div className="mt-2 space-y-1">
            {eventRootCandidates.length === 0 ? (
              <p className="text-[10px] italic text-slate-500 dark:text-gdc-mutedStrong">No nested object candidates on first record.</p>
            ) : (
              eventRootCandidates.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSelectEventRoot(absolutePathInSampleRecord(paths.eventArrayPath, p, previewIndexClamped))}
                  className={cn(
                    'flex w-full items-center justify-between rounded border px-2 py-1 font-mono text-[10px] text-slate-700 dark:text-slate-200',
                    paths.eventRootPath === p
                      ? 'border-violet-500/60 bg-violet-500/[0.08]'
                      : 'border-slate-200/90 hover:bg-slate-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover',
                  )}
                >
                  {p}
                  {paths.eventRootPath === p ? <Check className="h-3 w-3 text-violet-600" /> : null}
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const nextPaths = { ...paths, eventRootPath: '' }
              setPaths(nextPaths)
              onSetEventRootPath('')
              pulseSummary('eventRoot')
              pulseSummary('runtime')
            }}
            className="mt-2 text-[10px] font-semibold text-slate-600 underline dark:text-gdc-mutedStrong"
          >
            Use entire record (clear event root)
          </button>
          <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-200/70 pt-2 dark:border-gdc-border">
            <button
              type="button"
              onClick={() => void copyValue(paths.eventArrayPath || '$', 'Event array path copied')}
              className="rounded border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              Copy event source
            </button>
            <button
              type="button"
              onClick={() => void copyValue(paths.eventRootPath || '$', 'Event root copied')}
              className="rounded border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              Copy event root
            </button>
            <button
              type="button"
              onClick={() => void copyValue(summary.runtimeExtraction, 'Runtime expression copied')}
              className="rounded border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
            >
              Copy runtime path
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function SummaryCard({
  label,
  value,
  mono,
  pulse,
  testId,
  help,
}: {
  label: string
  value: string
  mono?: boolean
  pulse?: boolean
  testId?: string
  help?: { content: ReactNode; example?: string }
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'rounded-md border border-slate-200/80 bg-slate-50/80 p-2 transition-colors dark:border-gdc-border dark:bg-gdc-card',
        pulse && 'border-violet-400/80 bg-violet-500/[0.08] ring-1 ring-violet-400/40 dark:border-violet-500/50 dark:bg-violet-500/15',
      )}
    >
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-mutedStrong">
        {label}
        {help ? (
          <HelpTooltip
            content={help.content}
            example={help.example}
            ariaLabel={`${label} help`}
          />
        ) : null}
      </p>
      <p className={cn('mt-0.5 text-[11px] font-semibold text-slate-800 dark:text-slate-100', mono && 'break-all font-mono')}>
        {value}
      </p>
    </div>
  )
}

function CheckpointPanel({
  candidates,
  selectedPath,
  selectedType,
  extractedPreview,
  onSelect,
  onClear,
  onTypeChange,
  appliesTo,
}: {
  candidates: Array<{
    path: string
    checkpoint_type: WizardCheckpointFieldType
    confidence: number
    sample_value: unknown
    reason: string
  }>
  selectedPath: string
  selectedType: WizardCheckpointFieldType
  extractedPreview: Record<string, unknown> | null
  onSelect: (path: string, type: WizardCheckpointFieldType) => void
  onClear: () => void
  onTypeChange: (type: WizardCheckpointFieldType) => void
  appliesTo: string
}) {
  const previewValue = useMemo(() => {
    if (!selectedPath.trim() || !extractedPreview) return null
    const rel = selectedPath.startsWith('$.') ? selectedPath.slice(2) : selectedPath
    const parts = rel.split('.').filter(Boolean)
    let cur: unknown = extractedPreview
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return null
      cur = (cur as Record<string, unknown>)[part]
    }
    return cur
  }, [extractedPreview, selectedPath])

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Checkpoint</p>
        {selectedPath ? (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-[10px] text-red-600">
            <Trash2 className="h-3 w-3" aria-hidden />
            Remove
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">Paths are stored relative to each extracted event record.</p>

      {selectedPath ? (
        <div className="mt-2 rounded-md border border-violet-200/70 bg-violet-500/[0.06] p-2 dark:border-violet-500/30">
          <p className="font-mono text-[11px] font-semibold text-violet-900 dark:text-violet-100">{selectedPath}</p>
          <p className="mt-1 text-[10px] text-slate-600 dark:text-gdc-mutedStrong">
            Type: <span className="font-semibold">{selectedType || '—'}</span> · Applies to:{' '}
            <span className="font-mono">{appliesTo}</span>
          </p>
          {previewValue != null ? (
            <p className="mt-1 truncate font-mono text-[10px] text-slate-700 dark:text-slate-200">
              Sample: {String(previewValue)}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-2 max-h-[200px] space-y-1 overflow-auto">
        {candidates.map((c) => {
          const sel = selectedPath === c.path && selectedType === c.checkpoint_type
          return (
            <li key={`${c.path}-${c.checkpoint_type}`}>
              <button
                type="button"
                onClick={() => onSelect(c.path, c.checkpoint_type)}
                className={cn(
                  'flex w-full flex-col rounded border px-2 py-1.5 text-left text-[10px] text-slate-700 dark:text-slate-200',
                  sel ? 'border-violet-500/60 bg-violet-500/[0.08]' : 'border-slate-200/90 hover:bg-slate-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover',
                )}
              >
                <span className="font-mono font-semibold">{c.path}</span>
                <span className="text-slate-500 dark:text-gdc-mutedStrong">
                  {c.checkpoint_type} · {String(c.sample_value ?? '—')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
          Type
          <select
            value={selectedType}
            onChange={(e) => onTypeChange(e.target.value as WizardCheckpointFieldType)}
            className="mt-0.5 h-8 w-full rounded border px-1 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:[color-scheme:dark]"
          >
            <option value="">(not set)</option>
            <option value="TIMESTAMP">TIMESTAMP</option>
            <option value="EVENT_ID">EVENT_ID</option>
            <option value="CURSOR">CURSOR</option>
            <option value="OFFSET">OFFSET</option>
          </select>
        </label>
        <label className="text-[10px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
          Path (relative)
          <input
            value={selectedPath}
            onChange={(e) => onSelect(e.target.value, selectedType)}
            placeholder="event.eventTime"
            className="mt-0.5 h-8 w-full rounded border px-2 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-gdc-placeholder"
          />
        </label>
      </div>
    </div>
  )
}
