import { Copy } from 'lucide-react'
import { useCallback, useId, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import { computeMappingCoverage, computeSchemaDiff } from '../../../lib/mapping-coverage-schema-diff'
import { resolveJsonPath } from '../mapping-jsonpath'
import { PanelChrome } from '../mapping-json-tree'
import { applyMappingWithPassThrough } from '../../../utils/mappingPassThrough'
import { unmappedTopLevelSourcePaths } from './wizard-mapping-merge'
import type { WizardState, WizardUnmappedFieldsPolicy } from './wizard-state'

export type WizardMappingOutputAsideProps = {
  state: WizardState
  onChangeUnmappedFieldsPolicy?: (policy: WizardUnmappedFieldsPolicy) => void
  className?: string
}

const UNMAPPED_POLICY_OPTIONS: ReadonlyArray<{
  value: WizardUnmappedFieldsPolicy
  label: string
  description: string
  testId: string
}> = [
  {
    value: 'pass_through',
    label: 'Pass Through',
    description: 'Include unmapped source fields in mapped output with original field names (default).',
    testId: 'unmapped-fields-policy-pass_through',
  },
  {
    value: 'drop_unmapped',
    label: 'Drop',
    description: 'Remove unmapped fields from the output event. Mapped fields are still delivered.',
    testId: 'unmapped-fields-policy-drop',
  },
]

export function WizardMappingOutputAside({
  state,
  onChangeUnmappedFieldsPolicy,
  className,
}: WizardMappingOutputAsideProps) {
  const [previewTab, setPreviewTab] = useState<'preview' | 'raw_final'>('preview')
  const unmappedGroupId = useId()

  const sampleEvent = state.apiTest.extractedEvents[0] ?? null

  const mappedPreview = useMemo(() => {
    if (!sampleEvent) return null
    return applyMappingWithPassThrough(
      sampleEvent,
      state.mapping,
      resolveJsonPath,
      state.unmappedFieldsPolicy,
    )
  }, [sampleEvent, state.mapping, state.unmappedFieldsPolicy])

  const selectUnmappedPolicy = useCallback(
    (policy: WizardUnmappedFieldsPolicy) => {
      onChangeUnmappedFieldsPolicy?.(policy)
    },
    [onChangeUnmappedFieldsPolicy],
  )

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
    const sampleRecord =
      sampleEvent && typeof sampleEvent === 'object' && !Array.isArray(sampleEvent)
        ? (sampleEvent as Record<string, unknown>)
        : null
    const unmappedSourceCount = unmappedTopLevelSourcePaths(state.mapping, sampleRecord).length
    const missingRequired = state.mapping.some((r) => !r.outputField.trim() || !r.sourceJsonPath.trim())
    const potentialIssues =
      duplicateOutputKeys.size > 0 ||
      [...rowWarnings.values()].some((w) => w.dup || w.missing)
    const coverage = computeMappingCoverage({ sample: sampleRecord, mappingRows: state.mapping })
    const mappedRecord =
      mappedPreview && typeof mappedPreview === 'object' && !Array.isArray(mappedPreview)
        ? (mappedPreview as Record<string, unknown>)
        : null
    const schemaDiff = computeSchemaDiff({
      sample: sampleRecord,
      mappedOutput: mappedRecord,
      mappingRows: state.mapping,
    })
    return {
      mappedCount,
      staticCount,
      enrichedCount: staticCount,
      totalOutput: totalKeys.size,
      unmappedSourceCount,
      missingRequired,
      potentialIssues,
      coverage,
      schemaDiff,
    }
  }, [sampleEvent, state.mapping, state.enrichment, duplicateOutputKeys, rowWarnings, mappedPreview])

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

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 self-start overflow-y-auto lg:sticky lg:top-2 lg:max-h-[calc(100vh-8rem)]',
        className,
      )}
      data-testid="route-processing-output-workspace"
    >
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
        <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Unmapped Field Behavior</h4>
        <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
          How to handle source fields not covered by a mapping row. Drop removes fields from the output event only — it
          does not block delivery.
        </p>
        <div
          className="mt-3 space-y-2"
          role="radiogroup"
          aria-label="Unmapped Field Behavior"
          aria-describedby={unmappedGroupId}
        >
          <span id={unmappedGroupId} className="sr-only">
            Choose pass through or drop for unmapped source fields
          </span>
          {UNMAPPED_POLICY_OPTIONS.map((opt) => {
            const selected = state.unmappedFieldsPolicy === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectUnmappedPolicy(opt.value)}
                data-testid={opt.testId}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] transition-colors',
                  selected
                    ? 'border-violet-300/80 bg-violet-500/[0.06] dark:border-violet-500/40 dark:bg-violet-500/10'
                    : 'border-slate-200/80 hover:bg-slate-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                    selected
                      ? 'border-violet-600 bg-violet-600 dark:border-violet-400 dark:bg-violet-400'
                      : 'border-slate-400 dark:border-slate-500',
                  )}
                  aria-hidden
                >
                  {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-950" /> : null}
                </span>
                <span>
                  <span
                    className={cn(
                      'font-semibold',
                      selected ? 'text-violet-900 dark:text-violet-100' : 'text-slate-800 dark:text-slate-100',
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-slate-500 dark:text-gdc-muted">{opt.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section
        className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
        data-testid="mapping-coverage-panel"
      >
        <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Mapping Coverage</h4>
        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
          Share of sample top-level fields referenced by mapping rows.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <p className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">
            {stats.coverage.coveragePct == null ? '—' : `${stats.coverage.coveragePct}%`}
          </p>
          <ul className="space-y-0.5 text-[11px] text-slate-600 dark:text-gdc-mutedStrong">
            <li>
              Mapped {stats.coverage.mappedSourceCount} / {stats.coverage.sampleFieldCount}
            </li>
            <li>Unmapped {stats.coverage.unmappedSourceCount}</li>
          </ul>
        </div>
      </section>

      <section
        className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
        data-testid="schema-diff-panel"
      >
        <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Schema Diff</h4>
        <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
          Sample fields vs mapped output keys (added keys appear from mapping/enrichment).
        </p>
        {stats.schemaDiff.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-500">Load a sample event to compare schema paths.</p>
        ) : (
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[11px]">
            {stats.schemaDiff.slice(0, 40).map((row) => (
              <li key={`${row.kind}-${row.path}`} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-slate-700 dark:text-slate-200">{row.path}</span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    row.kind === 'mapped'
                      ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                      : row.kind === 'unmapped'
                        ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                        : 'bg-sky-500/15 text-sky-900 dark:text-sky-200',
                  )}
                >
                  {row.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Mapping Summary</h4>
        <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200">
          <li className="flex justify-between gap-2">
            <span className="text-slate-500">Mapped fields</span>
            <span className="font-semibold">{stats.mappedCount}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-slate-500">Unmapped source fields</span>
            <span
              className={cn(
                'font-semibold',
                stats.unmappedSourceCount === 0
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}
            >
              {stats.unmappedSourceCount}
            </span>
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
  )
}
