import { Copy, GripVertical, Info, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { resolveJsonPath } from '../mapping-jsonpath'
import { PanelChrome } from '../mapping-json-tree'
import { cn } from '../../../lib/utils'
import type { WizardEnrichmentRow, WizardState } from './wizard-state'

type StepEnrichmentProps = {
  state: WizardState
  onChange: (rows: WizardEnrichmentRow[]) => void
}

const inputCls =
  'h-7 w-full min-w-0 rounded-md border border-slate-200/90 bg-white px-2 text-[11px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

const VALUE_PLACEHOLDER_EXAMPLES: Record<string, string> = {
  vendor: 'Cybereason',
  product: 'EDR',
  log_type: 'malop',
  event_source: 'connector',
  collector_name: 'gdc-collector',
  tenant: 'default',
}

const PRESET_FIELDS = [
  'vendor',
  'product',
  'log_type',
  'event_source',
  'collector_name',
  'tenant',
] as const

const DEFAULT_PRESETS: ReadonlyArray<{ field: string; value: string }> = [
  { field: 'vendor', value: 'Cybereason' },
  { field: 'product', value: 'EDR' },
  { field: 'log_type', value: 'malop' },
  { field: 'event_source', value: 'connector' },
  { field: 'collector_name', value: 'gdc-collector' },
  { field: 'tenant', value: 'default' },
]

function newRowId(): string {
  return `enr-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
}

/** Normalize template whitespace for preview resolution (storage unchanged). */
function isNowUtcTemplate(s: string): boolean {
  return s.trim().replace(/\s/g, '').toLowerCase() === '{{now_utc}}'
}

function isTemplateValue(s: string): boolean {
  const t = s.trim()
  return t.startsWith('{{') && t.includes('}}')
}

function resolveEnrichmentPreviewValue(raw: string): unknown {
  if (isNowUtcTemplate(raw)) return new Date().toISOString()
  return raw
}

function enrichmentSourceLabel(value: string): string {
  const v = value.trim()
  if (!v) return '—'
  if (isNowUtcTemplate(v)) return 'Auto (System Time)'
  if (isTemplateValue(v)) return 'Auto'
  return 'Static'
}

function buildMappedBase(sampleEvent: Record<string, unknown> | null, mapping: WizardState['mapping']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!sampleEvent) return out
  for (const row of mapping) {
    const path = row.sourceJsonPath.trim()
    const key = row.outputField.trim()
    if (!path || !key) continue
    out[key] = resolveJsonPath(sampleEvent, path)
  }
  return out
}

/**
 * Matches runtime `KEEP_EXISTING`: enrichment does not replace keys already present after mapping.
 */
function applyEnrichmentKeepExisting(
  mapped: Record<string, unknown>,
  rows: WizardEnrichmentRow[],
): Record<string, unknown> {
  const next = { ...mapped }
  for (const row of rows) {
    const k = row.fieldName.trim()
    if (!k) continue
    if (Object.prototype.hasOwnProperty.call(next, k)) continue
    next[k] = resolveEnrichmentPreviewValue(row.value)
  }
  return next
}

export function StepEnrichment({ state, onChange }: StepEnrichmentProps) {
  const [previewTab, setPreviewTab] = useState<'preview' | 'raw_final'>('preview')
  const [flashRowId, setFlashRowId] = useState<string | null>(null)

  const sampleEvent = state.apiTest.extractedEvents[0] ?? null

  const mappedBase = useMemo(
    () => buildMappedBase(sampleEvent, state.mapping),
    [sampleEvent, state.mapping],
  )

  const duplicateEnrichmentKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of state.enrichment) {
      const k = row.fieldName.trim().toLowerCase()
      if (!k) continue
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [k, n] of counts) {
      if (n > 1) dups.add(k)
    }
    return dups
  }, [state.enrichment])

  const mappedKeysLower = useMemo(() => {
    const s = new Set<string>()
    for (const k of Object.keys(mappedBase)) s.add(k.toLowerCase())
    return s
  }, [mappedBase])

  const rowIssues = useMemo(() => {
    const map = new Map<string, { dup: boolean; mappedConflict: boolean; emptyName: boolean }>()
    for (const row of state.enrichment) {
      const key = row.fieldName.trim()
      const kl = key.toLowerCase()
      const dup = kl ? duplicateEnrichmentKeys.has(kl) : false
      const mappedConflict = kl.length > 0 && mappedKeysLower.has(kl)
      const emptyName = row.fieldName.trim().length === 0
      map.set(row.id, { dup, mappedConflict, emptyName })
    }
    return map
  }, [state.enrichment, duplicateEnrichmentKeys, mappedKeysLower])

  const finalEvent = useMemo(
    () => applyEnrichmentKeepExisting(mappedBase, state.enrichment),
    [mappedBase, state.enrichment],
  )

  const mappedJson = useMemo(() => {
    try {
      return JSON.stringify(mappedBase, null, 2)
    } catch {
      return '{}'
    }
  }, [mappedBase])

  const finalJson = useMemo(() => {
    try {
      return JSON.stringify(finalEvent, null, 2)
    } catch {
      return '{}'
    }
  }, [finalEvent])

  const bumpFlash = useCallback((rowId: string) => {
    setFlashRowId(rowId)
    window.setTimeout(() => setFlashRowId(null), 2200)
  }, [])

  const update = useCallback(
    (idx: number, patch: Partial<WizardEnrichmentRow>) => {
      const next = state.enrichment.map((r, i) => (i === idx ? { ...r, ...patch } : r))
      onChange(next)
    },
    [onChange, state.enrichment],
  )

  const remove = useCallback(
    (idx: number) => {
      onChange(state.enrichment.filter((_, i) => i !== idx))
    },
    [onChange, state.enrichment],
  )

  const addEmpty = useCallback(() => {
    const id = newRowId()
    onChange([...state.enrichment, { id, fieldName: '', value: '' }])
    bumpFlash(id)
  }, [bumpFlash, onChange, state.enrichment])

  const addPreset = useCallback(
    (preset: { field: string; value: string }) => {
      const exists = state.enrichment.some(
        (r) => r.fieldName.trim().toLowerCase() === preset.field.toLowerCase(),
      )
      if (exists) return
      const id = newRowId()
      onChange([...state.enrichment, { id, fieldName: preset.field, value: preset.value }])
      bumpFlash(id)
    },
    [bumpFlash, onChange, state.enrichment],
  )

  const duplicateRow = useCallback(
    (idx: number) => {
      const row = state.enrichment[idx]
      if (!row) return
      const id = newRowId()
      const next = [...state.enrichment]
      next.splice(idx + 1, 0, {
        id,
        fieldName: row.fieldName.trim() ? `${row.fieldName}_copy` : '',
        value: row.value,
      })
      onChange(next)
      bumpFlash(id)
    },
    [bumpFlash, onChange, state.enrichment],
  )

  const resetEnrichment = useCallback(() => {
    if (state.enrichment.length === 0) return
    if (!window.confirm('Reset all enrichment fields? This cannot be undone in the wizard.')) return
    onChange([])
  }, [onChange, state.enrichment.length])

  const copyFinalJson = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(finalJson)
      }
    } catch {
      // ignore
    }
  }, [finalJson])

  const summary = useMemo(() => {
    let staticN = 0
    let autoN = 0
    const namedFields: string[] = []
    for (const row of state.enrichment) {
      const name = row.fieldName.trim()
      if (!name) continue
      namedFields.push(name)
      const src = enrichmentSourceLabel(row.value)
      if (src === 'Static') staticN += 1
      else if (src.startsWith('Auto')) autoN += 1
    }
    const total = namedFields.length
    let mappedConflicts = 0
    const seen = new Set<string>()
    for (const row of state.enrichment) {
      const k = row.fieldName.trim()
      if (!k) continue
      const kl = k.toLowerCase()
      if (mappedKeysLower.has(kl) && !seen.has(kl)) {
        mappedConflicts += 1
        seen.add(kl)
      }
    }
    const potentialIssues =
      duplicateEnrichmentKeys.size > 0 ||
      [...rowIssues.values()].some((w) => w.mappedConflict || w.emptyName)

    const topChips = namedFields.slice(0, 12)

    return {
      staticN,
      autoN,
      total,
      mappedConflicts,
      potentialIssues,
      topChips,
    }
  }, [
    duplicateEnrichmentKeys.size,
    mappedKeysLower,
    rowIssues,
    state.enrichment,
  ])

  const filledCount = state.enrichment.filter((e) => e.fieldName.trim().length > 0).length

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
        Add static fields or metadata to enrich your events. These fields will be included in the final output.
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        {/* Left: editor */}
        <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Enrichment</h3>
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:text-violet-200">
                  {filledCount} fields
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={resetEnrichment}
                disabled={state.enrichment.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Reset enrichment
              </button>
              <button
                type="button"
                onClick={addEmpty}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add field
              </button>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quick Add Presets</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEFAULT_PRESETS.map((p) => {
                const added = state.enrichment.some(
                  (r) => r.fieldName.trim().toLowerCase() === p.field.toLowerCase(),
                )
                return (
                  <button
                    key={p.field}
                    type="button"
                    disabled={added}
                    onClick={() => addPreset(p)}
                    title={added ? 'Already added' : `Add ${p.field}`}
                    className={cn(
                      'inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
                      added
                        ? 'cursor-not-allowed border-violet-200/80 bg-violet-500/10 text-violet-600 opacity-80 dark:border-violet-500/30 dark:text-violet-300'
                        : 'border-violet-300/70 bg-violet-500/[0.07] text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-200 dark:hover:bg-violet-500/20',
                    )}
                  >
                    {p.field}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4 min-h-0">
            {state.enrichment.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
                <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200">No enrichment fields yet</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-gdc-muted">
                  Use Quick Add Presets or Add field. Optional presets include{' '}
                  <span className="font-mono text-[10px]">{PRESET_FIELDS.join(', ')}</span>.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-gdc-border">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="bg-slate-50/95 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-gdc-tableHeader dark:text-gdc-muted">
                    <tr className="border-b border-slate-200/80 dark:border-gdc-border">
                      <th className="w-8 px-1 py-1.5" aria-hidden />
                      <th className="min-w-[100px] px-1.5 py-1.5">Field Key</th>
                      <th className="min-w-[120px] px-1.5 py-1.5">Value</th>
                      <th className="min-w-[88px] px-1.5 py-1.5">Source</th>
                      <th className="w-[72px] px-1 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.enrichment.map((row, idx) => {
                      const issues = rowIssues.get(row.id)
                      const isFlash = flashRowId === row.id
                      const ph = VALUE_PLACEHOLDER_EXAMPLES[row.fieldName.trim().toLowerCase()] ?? 'Enter value'
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'border-b border-slate-100 dark:border-gdc-border',
                            isFlash && 'bg-violet-500/[0.12]',
                          )}
                        >
                          <td className="align-middle px-0.5 py-1 text-slate-400">
                            <GripVertical className="mx-auto h-3.5 w-3.5 opacity-50" aria-hidden />
                          </td>
                          <td className="max-w-[140px] px-1 py-1 align-middle">
                            <input
                              value={row.fieldName}
                              placeholder="field_key"
                              onChange={(e) => update(idx, { fieldName: e.target.value })}
                              className={cn(
                                inputCls,
                                'font-mono text-[10px]',
                                issues?.dup && 'border-amber-400 dark:border-amber-600',
                                issues?.emptyName && 'border-amber-400 dark:border-amber-600',
                              )}
                              aria-label="Field key"
                            />
                            {issues?.dup ? (
                              <span className="mt-0.5 block text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                                Duplicate key
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[1px] px-1 py-1 align-middle">
                            <input
                              value={row.value}
                              placeholder={ph}
                              onChange={(e) => update(idx, { value: e.target.value })}
                              className={cn(inputCls, 'font-mono text-[10px]')}
                              aria-label="Field value"
                            />
                          </td>
                          <td className="whitespace-nowrap px-1 py-1 align-middle">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-px text-[9px] font-semibold text-slate-700 dark:bg-gdc-elevated dark:text-slate-200">
                              {enrichmentSourceLabel(row.value)}
                            </span>
                            {issues?.mappedConflict ? (
                              <span
                                className="mt-0.5 block text-[9px] font-semibold text-amber-700 dark:text-amber-300"
                                title="Mapped output already includes this key; enrichment is skipped (KEEP_EXISTING)."
                              >
                                Mapped key exists
                              </span>
                            ) : null}
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
                              onClick={() => remove(idx)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                              aria-label="Remove row"
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
              </div>
            )}
          </div>

          <p className="mt-3 flex items-center gap-1 text-[10px] text-slate-500 dark:text-gdc-muted">
            <Info className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            Drag to reorder fields (ordering follows list order; reordering UI is not enabled).
          </p>
        </section>

        {/* Right: preview + summary */}
        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-5rem)] xl:self-start xl:overflow-y-auto">
          <PanelChrome title="Final Event Preview" className="max-h-[min(46vh,480px)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
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
                  {finalJson}
                </pre>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Mapped output (before enrichment)</p>
                    <pre className="max-h-[34vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-900 p-2 text-[9px] leading-snug text-slate-200 dark:border-gdc-border">
                      {mappedJson}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">Final (mapped + enrichment)</p>
                    <pre className="max-h-[34vh] overflow-auto rounded-lg border border-slate-200/80 bg-slate-950 p-2 text-[9px] leading-snug text-emerald-100 dark:border-gdc-border">
                      {finalJson}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            <p className="border-t border-slate-100 px-2.5 py-2 text-[10px] text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
              Matches destination payload shape for KEEP_EXISTING: overlapping keys keep mapped values.
            </p>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Enrichment Summary</h4>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:justify-between">
              <ul className="min-w-0 flex-1 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200">
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Static fields added</span>
                  <span className="font-semibold">{summary.staticN}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Auto fields added</span>
                  <span className="font-semibold">{summary.autoN}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Total enrichment fields</span>
                  <span className="font-semibold text-violet-700 dark:text-violet-300">{summary.total}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500" title="Enrichment keys that match mapped output keys are not applied when override policy is KEEP_EXISTING.">
                    Overridden original fields
                  </span>
                  <span className="font-semibold">{summary.mappedConflicts}</span>
                </li>
                <li className="flex justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-gdc-border">
                  <span className="text-slate-500">Potential issues</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-semibold',
                      summary.potentialIssues ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {summary.potentialIssues ? '⚠ Review' : '✓ None'}
                  </span>
                </li>
              </ul>
              <div className="min-w-0 sm:max-w-[220px]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Top enrichment fields</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {summary.topChips.length === 0 ? (
                    <span className="text-[11px] text-slate-400">—</span>
                  ) : (
                    summary.topChips.map((name) => (
                      <span
                        key={name}
                        className="inline-flex rounded-full border border-violet-300/60 bg-violet-500/[0.08] px-2 py-px text-[10px] font-semibold text-violet-800 dark:border-violet-500/35 dark:text-violet-200"
                      >
                        {name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
