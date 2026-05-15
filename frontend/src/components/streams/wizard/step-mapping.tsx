import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Layers,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { resolveJsonPath } from '../mapping-jsonpath'
import { MappingJsonTree, PanelChrome, type MappingJsonTreeExpandStrategy } from '../mapping-json-tree'
import { cn } from '../../../lib/utils'
import type { WizardMappingRow, WizardState } from './wizard-state'
import { flattenSampleFields } from './wizard-json-extract'

type StepMappingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
}

const inputCls =
  'h-7 w-full min-w-0 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

const SUGGESTED_FIELD_GROUPS: ReadonlyArray<{ title: string; names: readonly string[] }> = [
  {
    title: 'Common Fields',
    names: ['message', 'severity', 'title', 'description', 'event_type', 'category', 'type', 'name'],
  },
  {
    title: 'Identifiers',
    names: ['id', '_id', 'event_id', 'uuid', 'guid', 'anomaly_id', 'src_ip', 'dst_ip', 'host', 'hostname'],
  },
  {
    title: 'Timestamps',
    names: ['timestamp', '@timestamp', 'time', 'created_at', 'updated_at', 'event_time', 'ts'],
  },
]

function suggestOutputField(jsonPath: string): string {
  const segments = jsonPath.split(/[\.\[\]]/).filter(Boolean)
  const last = segments[segments.length - 1] ?? 'field'
  return last.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || 'field'
}

function relativeToRootPath(jsonPath: string, rootPath: string): string {
  const rp = rootPath.trim()
  if (!rp || rp === '$') return jsonPath
  const rootPrefix = rp.startsWith('$') ? rp : `$.${rp}`
  if (jsonPath === rootPrefix) return '$'
  if (jsonPath.startsWith(`${rootPrefix}.`) || jsonPath.startsWith(`${rootPrefix}[`)) {
    const rest = jsonPath.slice(rootPrefix.length)
    const stripped = rest.replace(/^\[\d+\]/, '')
    return stripped ? `$${stripped}` : '$'
  }
  return jsonPath
}

function newRowId(): string {
  return `row-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

function formatEventArrayLabel(state: WizardState): string {
  if (state.stream.useWholeResponseAsEvent) return '(whole response)'
  const p = state.stream.eventArrayPath.trim()
  if (!p) return '$'
  return p.startsWith('$') ? p : `$.${p}`
}

function inferValueType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t === 'object') return 'object'
  return t
}

function truncatePreview(v: unknown, max = 56): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') {
    return v.length > max ? `${v.slice(0, max)}…` : v
  }
  try {
    const s = JSON.stringify(v)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return String(v)
  }
}

function findSuggestionPath(suggestionName: string, flatPaths: string[]): string | null {
  const want = suggestionName.replace(/^@/, '').toLowerCase()
  const snLower = suggestionName.toLowerCase()
  const exact = flatPaths.find((p) => {
    const seg = p.split(/[\.\[\]]/).filter(Boolean).pop()
    if (!seg) return false
    const sl = seg.toLowerCase().replace(/^@/, '')
    return sl === want || seg.toLowerCase() === snLower
  })
  return exact ?? null
}

export function StepMapping({ state, onChangeMapping }: StepMappingProps) {
  const [treeSearch, setTreeSearch] = useState('')
  const [sampleView, setSampleView] = useState<'tree' | 'json'>('tree')
  const [previewTab, setPreviewTab] = useState<'preview' | 'raw_final'>('preview')
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)
  const [flashRowId, setFlashRowId] = useState<string | null>(null)
  const [treeExpandStrategy, setTreeExpandStrategy] = useState<MappingJsonTreeExpandStrategy>('smart')
  const [treeMountKey, setTreeMountKey] = useState(0)
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false)

  const sampleEvent = state.apiTest.extractedEvents[0] ?? null
  const rootPath = state.stream.eventRootPath.trim() || '$'
  const quickFields = useMemo(() => {
    const fromAnalysis = state.apiTest.analysis?.flatPreviewFields
    if (fromAnalysis?.length) return fromAnalysis
    return flattenSampleFields(sampleEvent)
  }, [sampleEvent, state.apiTest.analysis?.flatPreviewFields])

  const flashHighlightPath = useMemo(() => {
    const row = state.mapping.find((r) => r.id === flashRowId)
    return row?.sourceJsonPath.trim() ?? null
  }, [flashRowId, state.mapping])

  const bumpFlash = useCallback((rowId: string) => {
    setFlashRowId(rowId)
    window.setTimeout(() => setFlashRowId(null), 2800)
  }, [])

  const handlePickPath = useCallback(
    (jsonPath: string) => {
      const relPath = relativeToRootPath(jsonPath, rootPath)
      let duplicate = false
      const next = [...state.mapping]
      if (next.some((m) => m.sourceJsonPath === relPath)) {
        duplicate = true
      } else {
        const id = newRowId()
        next.push({
          id,
          outputField: suggestOutputField(relPath),
          sourceJsonPath: relPath,
        })
        bumpFlash(id)
      }
      if (duplicate) {
        setDuplicateNotice(`Already mapped: ${relPath}`)
        window.setTimeout(() => setDuplicateNotice(null), 2500)
        return
      }
      setDuplicateNotice(null)
      onChangeMapping(next)
    },
    [rootPath, onChangeMapping, state.mapping, bumpFlash],
  )

  const autoSuggest = useCallback(() => {
    if (!sampleEvent) return
    const next: WizardMappingRow[] = [...state.mapping]
    const seen = new Set(next.map((m) => m.sourceJsonPath))
    for (const key of Object.keys(sampleEvent)) {
      const path = `$.${key}`
      if (seen.has(path)) continue
      const id = newRowId()
      next.push({ id, outputField: suggestOutputField(key), sourceJsonPath: path })
      seen.add(path)
    }
    onChangeMapping(next)
  }, [onChangeMapping, sampleEvent, state.mapping])

  const resetMapping = useCallback(() => {
    if (state.mapping.length === 0) return
    if (!window.confirm('Clear all field mappings?')) return
    onChangeMapping([])
    setDuplicateNotice(null)
  }, [onChangeMapping, state.mapping.length])

  const clearAllRows = useCallback(() => {
    resetMapping()
  }, [resetMapping])

  const mappedPreview = useMemo(() => {
    if (!sampleEvent) return null
    const out: Record<string, unknown> = {}
    for (const row of state.mapping) {
      const path = row.sourceJsonPath.trim()
      const key = row.outputField.trim()
      if (!path || !key) continue
      out[key] = resolveJsonPath(sampleEvent, path)
    }
    return out
  }, [sampleEvent, state.mapping])

  const rawSampleJson = useMemo(() => {
    if (!sampleEvent) return ''
    try {
      return JSON.stringify(sampleEvent, null, 2)
    } catch {
      return ''
    }
  }, [sampleEvent])

  const mappedPreviewJson = useMemo(() => {
    if (!mappedPreview) return ''
    try {
      return JSON.stringify(mappedPreview, null, 2)
    } catch {
      return ''
    }
  }, [mappedPreview])

  const duplicateOutputKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of state.mapping) {
      const k = row.outputField.trim().toLowerCase()
      if (!k) continue
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [k, n] of counts) {
      if (n > 1) dups.add(k)
    }
    return dups
  }, [state.mapping])

  const rowWarnings = useMemo(() => {
    const map = new Map<string, { dup: boolean; missing: boolean }>()
    if (!sampleEvent) return map
    for (const row of state.mapping) {
      const key = row.outputField.trim().toLowerCase()
      const dup = key ? duplicateOutputKeys.has(key) : false
      const path = row.sourceJsonPath.trim()
      let missing = false
      if (path) {
        const v = resolveJsonPath(sampleEvent, path)
        missing = v === undefined || v === null
      }
      map.set(row.id, { dup, missing })
    }
    return map
  }, [sampleEvent, state.mapping, duplicateOutputKeys])

  const stats = useMemo(() => {
    const mappedCount = state.mapping.filter((r) => r.outputField.trim() && r.sourceJsonPath.trim()).length
    const staticCount = state.enrichment.filter((e) => e.fieldName.trim()).length
    const totalKeys = new Set<string>()
    for (const r of state.mapping) {
      const k = r.outputField.trim()
      if (k) totalKeys.add(k)
    }
    for (const e of state.enrichment) {
      const k = e.fieldName.trim()
      if (k) totalKeys.add(k)
    }
    const missingRequired = state.mapping.some((r) => !r.outputField.trim() || !r.sourceJsonPath.trim())
    const potentialIssues =
      duplicateOutputKeys.size > 0 ||
      [...rowWarnings.values()].some((w) => w.dup || w.missing)
    return {
      mappedCount,
      staticCount,
      enrichedCount: staticCount,
      totalOutput: totalKeys.size,
      missingRequired,
      potentialIssues,
    }
  }, [state.mapping, state.enrichment, duplicateOutputKeys, rowWarnings])

  const handleSuggestedChip = useCallback(
    (name: string) => {
      const path = findSuggestionPath(name, quickFields)
      if (!path) return
      handlePickPath(path)
    },
    [quickFields, handlePickPath],
  )

  const copyFinalJson = useCallback(async () => {
    const text = mappedPreviewJson || '{}'
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      // ignore
    }
  }, [mappedPreviewJson])

  const duplicateRow = useCallback(
    (idx: number) => {
      const row = state.mapping[idx]
      if (!row) return
      const next = [...state.mapping]
      next.splice(idx + 1, 0, {
        id: newRowId(),
        outputField: `${row.outputField}_copy`,
        sourceJsonPath: row.sourceJsonPath,
      })
      onChangeMapping(next)
    },
    [onChangeMapping, state.mapping],
  )

  const expandAll = useCallback(() => {
    setTreeExpandStrategy('all')
    setTreeMountKey((k) => k + 1)
  }, [])

  const collapseAll = useCallback(() => {
    setTreeExpandStrategy('minimal')
    setTreeMountKey((k) => k + 1)
  }, [])

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <p className="text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
        Map fields from the sample event to your output schema. Click a field in the JSON to add it to the mapping.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={autoSuggest}
          disabled={!sampleEvent}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-300/70 bg-white px-3 text-[12px] font-semibold text-violet-700 shadow-sm hover:bg-violet-500/[0.08] disabled:opacity-60 dark:border-violet-500/40 dark:bg-gdc-card dark:text-violet-300 dark:hover:bg-violet-500/15"
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          Auto-suggest top-level fields
        </button>
        <button
          type="button"
          onClick={resetMapping}
          disabled={state.mapping.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Reset mapping
        </button>
      </div>

      {!sampleEvent ? (
        <p className="mt-4 rounded-md border border-amber-200/80 bg-amber-500/[0.06] p-3 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Run the Fetch Sample Data step first so we can show a sample event. You can also add empty rows and configure them
          manually below.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(260px,1fr)_minmax(300px,1.2fr)_minmax(260px,320px)]">
        {/* Left: sample event */}
        <PanelChrome
          className="max-h-[min(72vh,760px)]"
          title="Sample Event"
          right={duplicateNotice ? <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{duplicateNotice}</span> : null}
        >
          <div className="space-y-2 p-2.5">
            <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-gdc-muted">
              <p>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Event array: </span>
                <span className="font-mono text-violet-700 dark:text-violet-300">{formatEventArrayLabel(state)}</span>
              </p>
              <p>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Records: </span>
                {state.apiTest.eventCount}
              </p>
            </div>

            {sampleView === 'tree' && sampleEvent ? (
              <MappingJsonTree
                key={`${treeMountKey}-${treeExpandStrategy}`}
                value={sampleEvent}
                baseLabel="event"
                basePath="$"
                search={treeSearch}
                onPickPath={handlePickPath}
                expandStrategy={treeExpandStrategy}
                activeHighlightPath={flashHighlightPath}
              />
            ) : null}
            {sampleView === 'json' && sampleEvent ? (
              <pre className="max-h-[48vh] overflow-auto rounded-md border border-slate-200/80 bg-slate-950/90 p-2 text-[10px] leading-snug text-emerald-100 dark:border-gdc-border">
                {rawSampleJson}
              </pre>
            ) : null}
            {!sampleEvent ? (
              <p className="px-1 py-3 text-[11px] italic text-slate-500">No sample event available yet.</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 dark:border-gdc-border">
              <div className="inline-flex rounded-md border border-slate-200/90 p-0.5 dark:border-gdc-border">
                <button
                  type="button"
                  onClick={() => setSampleView('tree')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sampleView === 'tree'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                  )}
                >
                  Tree
                </button>
                <button
                  type="button"
                  onClick={() => setSampleView('json')}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-semibold',
                    sampleView === 'json'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                  )}
                >
                  JSON
                </button>
              </div>
              <input
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                placeholder="Search fields…"
                className="h-7 min-w-[140px] flex-1 rounded-md border border-slate-200/90 bg-white px-2 text-[10px] dark:border-gdc-border dark:bg-gdc-card"
                aria-label="Search fields"
              />
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={expandAll}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200/90 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                  title="Expand all"
                  aria-label="Expand all"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200/90 text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover"
                  title="Collapse all"
                  aria-label="Collapse all"
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Showing first event in the selected event array</p>
          </div>
        </PanelChrome>

        {/* Center: mapping + suggestions */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <PanelChrome
            className="max-h-[min(52vh,560px)] min-h-0"
            title="Field Mapping"
            right={
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:text-violet-200">
                {stats.mappedCount} mapped
              </span>
            }
          >
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <button
                type="button"
                onClick={() =>
                  onChangeMapping([...state.mapping, { id: newRowId(), outputField: '', sourceJsonPath: '' }])
                }
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add row
              </button>
              <button
                type="button"
                onClick={clearAllRows}
                disabled={state.mapping.length === 0}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200/90 bg-white px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:bg-gdc-card dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Clear all
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              {state.mapping.length === 0 ? (
                <p className="p-3 text-[11px] italic text-slate-500">
                  No mappings yet. Click a JSON node on the left to add one, or use Auto-suggest.
                </p>
              ) : (
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 z-[1] bg-slate-50/95 text-[10px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur-sm dark:bg-gdc-tableHeader dark:text-gdc-muted">
                    <tr className="border-b border-slate-200/80 dark:border-gdc-border">
                      <th className="w-7 px-1 py-1.5" aria-hidden />
                      <th className="px-1.5 py-1.5">Output Field</th>
                      <th className="px-1.5 py-1.5">Source Path</th>
                      <th className="w-16 px-1 py-1.5">Type</th>
                      <th className="px-1.5 py-1.5">Sample</th>
                      <th className="w-16 px-1 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.mapping.map((row, idx) => {
                      const path = row.sourceJsonPath.trim()
                      const resolved = sampleEvent && path ? resolveJsonPath(sampleEvent, path) : undefined
                      const typ = inferValueType(resolved)
                      const warn = rowWarnings.get(row.id)
                      const isNew = flashRowId === row.id
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'border-b border-slate-100 dark:border-gdc-border',
                            isNew && 'bg-violet-500/[0.12]',
                          )}
                        >
                          <td className="align-middle px-0.5 py-1 text-slate-400">
                            <GripVertical className="mx-auto h-3.5 w-3.5 opacity-50" aria-hidden />
                          </td>
                          <td className="max-w-[120px] px-1 py-1 align-middle">
                            <input
                              value={row.outputField}
                              placeholder="event_id"
                              onChange={(e) => {
                                const next = [...state.mapping]
                                next[idx] = { ...row, outputField: e.target.value }
                                onChangeMapping(next)
                              }}
                              className={cn(
                                inputCls,
                                warn?.dup && 'border-amber-400 focus:border-amber-500 dark:border-amber-600',
                              )}
                              aria-label="Output field"
                            />
                            {isNew ? (
                              <span className="mt-0.5 inline-block rounded bg-violet-600 px-1 py-px text-[9px] font-bold text-white">
                                New
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[1px] px-1 py-1 align-middle">
                            <input
                              value={row.sourceJsonPath}
                              placeholder="$.id"
                              onChange={(e) => {
                                const next = [...state.mapping]
                                next[idx] = { ...row, sourceJsonPath: e.target.value }
                                onChangeMapping(next)
                              }}
                              className={cn(inputCls, 'font-mono text-[10px]')}
                              aria-label="Source JSONPath"
                            />
                          </td>
                          <td className="px-1 py-1 align-middle">
                            <span className="inline-flex rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-semibold capitalize text-violet-800 dark:text-violet-200">
                              {typ}
                            </span>
                          </td>
                          <td
                            className={cn(
                              'max-w-[140px] truncate px-1 py-1 align-middle font-mono text-[10px] text-slate-600 dark:text-gdc-mutedStrong',
                              warn?.missing && 'text-amber-700 dark:text-amber-300',
                            )}
                            title={truncatePreview(resolved, 500)}
                          >
                            {truncatePreview(resolved)}
                          </td>
                          <td className="whitespace-nowrap px-0.5 py-1 align-middle text-right">
                            <button
                              type="button"
                              onClick={() => duplicateRow(idx)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-500 hover:bg-slate-100 hover:text-violet-700 dark:hover:bg-gdc-rowHover dark:hover:text-violet-300"
                              aria-label="Duplicate row"
                              title="Duplicate row"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => onChangeMapping(state.mapping.filter((m) => m.id !== row.id))}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                              aria-label="Remove mapping row"
                              title="Remove row"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Suggested Fields</h4>
            <div className="mt-2 space-y-3">
              {SUGGESTED_FIELD_GROUPS.map((group) => {
                const names = suggestionsExpanded ? group.names : group.names.slice(0, 6)
                return (
                  <div key={group.title}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {names.map((name) => {
                        const exists = findSuggestionPath(name, quickFields) != null
                        return (
                          <button
                            key={`${group.title}-${name}`}
                            type="button"
                            disabled={!exists}
                            onClick={() => handleSuggestedChip(name)}
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                              exists
                                ? 'border-slate-200/90 bg-white text-slate-700 hover:border-violet-400 hover:bg-violet-500/[0.06] dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200'
                                : 'cursor-not-allowed border-slate-100 bg-slate-100/80 text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted',
                            )}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setSuggestionsExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              {suggestionsExpanded ? (
                <>
                  Show fewer suggestions <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </>
              ) : (
                <>
                  Show more suggestions <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </>
              )}
            </button>
          </section>
        </div>

        {/* Right: preview + summary */}
        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
          <PanelChrome title="Final Event Preview" className="max-h-[min(42vh,440px)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  Live
                </span>
                <div className="inline-flex rounded-md border border-slate-200/90 p-0.5 dark:border-gdc-border">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('preview')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-semibold',
                      previewTab === 'preview'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                    )}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('raw_final')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-semibold',
                      previewTab === 'raw_final'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
                    )}
                  >
                    Raw vs Final
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copyFinalJson()}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy JSON
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-2">
              {previewTab === 'preview' ? (
                <pre className="overflow-x-auto rounded-lg border border-slate-200/80 bg-slate-950 p-2.5 text-[10px] leading-snug text-emerald-100 dark:border-gdc-border">
                  {mappedPreviewJson || '—'}
                </pre>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Raw sample (first event)</p>
                    <pre className="max-h-[32vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-900 p-2 text-[9px] leading-snug text-slate-200 dark:border-gdc-border">
                      {rawSampleJson || '—'}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Mapped output</p>
                    <pre className="max-h-[32vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-950 p-2 text-[9px] leading-snug text-emerald-100 dark:border-gdc-border">
                      {mappedPreviewJson || '—'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Mapping Summary</h4>
            <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200">
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Mapped fields</span>
                <span className="font-semibold">{stats.mappedCount}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Static fields</span>
                <span className="font-semibold">{stats.staticCount}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-slate-500">Enriched fields</span>
                <span className="font-semibold">{stats.enrichedCount}</span>
              </li>
              <li className="flex justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-gdc-border">
                <span className="text-slate-500">Total output fields</span>
                <span className="font-semibold text-violet-700 dark:text-violet-300">{stats.totalOutput}</span>
              </li>
            </ul>
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 dark:border-gdc-border">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-600 dark:text-gdc-mutedStrong">Required fields missing</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                  {stats.missingRequired ? '⚠' : '✓'} {stats.missingRequired ? 'Yes' : 'None'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-600 dark:text-gdc-mutedStrong">Potential issues</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold',
                    stats.potentialIssues ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  {stats.potentialIssues ? '⚠ Review' : '✓ None'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
