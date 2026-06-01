import { AlertTriangle, Copy, Info, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  runEnrichmentExecPreview,
  runEnrichmentValidate,
  type EnrichmentExecPreviewWarning,
  type EnrichmentValidationIssue,
} from '../../../api/gdcRuntimePreview'
import { PanelChrome } from '../mapping-json-tree'
import { cn } from '../../../lib/utils'
import { EnrichmentRulesEditor } from './enrichment-rules-editor'
import {
  countDuplicateEnrichmentFieldNames,
  countRulesByType,
  enrichmentDictFromRules,
  enrichmentRuleSourceLabel,
  type WizardEnrichmentRule,
} from './enrichment-rules-model'
import { buildMappedBaseFromState } from './wizard-review-preview'
import type { WizardState } from './wizard-state'

type StepEnrichmentProps = {
  state: WizardState
  onChange: (rows: WizardEnrichmentRule[]) => void
  onValidationBlockersChange?: (blockers: { hasErrors: boolean; reason: string | null }) => void
}

export function StepEnrichment({ state, onChange, onValidationBlockersChange }: StepEnrichmentProps) {
  const [previewTab, setPreviewTab] = useState<'preview' | 'raw_final'>('preview')
  const [finalEvent, setFinalEvent] = useState<Record<string, unknown>>({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewWarnings, setPreviewWarnings] = useState<EnrichmentExecPreviewWarning[]>([])
  const [validationIssues, setValidationIssues] = useState<EnrichmentValidationIssue[]>([])
  const [validationLoading, setValidationLoading] = useState(false)

  const sampleEvent = state.apiTest.extractedEvents[0] ?? null

  const mappedBase = useMemo(
    () => buildMappedBaseFromState(sampleEvent, state.mapping),
    [sampleEvent, state.mapping],
  )

  const enrichmentPayload = useMemo(
    () => enrichmentDictFromRules(state.enrichment),
    [state.enrichment],
  )

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setPreviewLoading(true)
        setValidationLoading(true)
        setPreviewError(null)
        try {
          const [validateRes, previewRes] = await Promise.all([
            runEnrichmentValidate({ enrichment: enrichmentPayload }),
            runEnrichmentExecPreview({
              mapped_event: mappedBase,
              enrichment: enrichmentPayload,
              override_policy: 'KEEP_EXISTING',
            }),
          ])
          if (!cancelled) {
            setValidationIssues(validateRes.issues)
            setPreviewWarnings(previewRes.warnings)
            setFinalEvent(previewRes.final_event)
            const errors = validateRes.issues.filter((i) => i.severity === 'error')
            const emptyTargets = state.enrichment.some((r) => r.enabled && !r.fieldName.trim())
            const hasErrors = !validateRes.ok || emptyTargets
            let reason: string | null = null
            if (emptyTargets) reason = 'Each enabled rule needs a target field.'
            else if (errors.length > 0) reason = errors[0]?.message ?? 'Fix enrichment validation errors.'
            onValidationBlockersChange?.({ hasErrors, reason })
          }
        } catch (err) {
          if (!cancelled) {
            setPreviewError(err instanceof Error ? err.message : 'Enrichment preview failed')
            setFinalEvent({ ...mappedBase })
            setPreviewWarnings([])
            onValidationBlockersChange?.({ hasErrors: true, reason: 'Enrichment preview failed.' })
          }
        } finally {
          if (!cancelled) {
            setPreviewLoading(false)
            setValidationLoading(false)
          }
        }
      })()
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mappedBase, enrichmentPayload, onValidationBlockersChange, state.enrichment])

  const mappedKeysLower = useMemo(() => {
    const s = new Set<string>()
    for (const k of Object.keys(mappedBase)) s.add(k.toLowerCase())
    return s
  }, [mappedBase])

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

  const copyFinalJson = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(finalJson)
      }
    } catch {
      // ignore
    }
  }, [finalJson])

  const typeCounts = useMemo(() => countRulesByType(state.enrichment), [state.enrichment])

  const validationErrorCount = validationIssues.filter((i) => i.severity === 'error').length
  const validationWarningCount = validationIssues.filter((i) => i.severity === 'warning').length

  const summary = useMemo(() => {
    let staticN = 0
    let autoN = 0
    const namedFields: string[] = []
    for (const row of state.enrichment) {
      const name = row.fieldName.trim()
      if (!name || !row.enabled) continue
      namedFields.push(name)
      const src = enrichmentRuleSourceLabel(row)
      if (row.type === 'static') {
        if (src === 'Static') staticN += 1
        else if (src.startsWith('Auto')) autoN += 1
      }
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
    const dupCount = countDuplicateEnrichmentFieldNames(state.enrichment)
    const potentialIssues =
      dupCount > 0 ||
      validationErrorCount > 0 ||
      validationWarningCount > 0 ||
      previewWarnings.length > 0 ||
      state.enrichment.some((r) => !r.fieldName.trim() && r.label.trim())

    return {
      staticN,
      autoN,
      total,
      mappedConflicts,
      potentialIssues,
      topChips: namedFields.slice(0, 12),
      typeCounts,
    }
  }, [
    mappedKeysLower,
    previewWarnings.length,
    state.enrichment,
    typeCounts,
    validationErrorCount,
    validationWarningCount,
  ])

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
        Add static values, calculated expressions, lookups, conditional logic, or normalized fields to enrich your events.
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <EnrichmentRulesEditor
          rules={state.enrichment}
          onChange={onChange}
          mappedKeysLower={mappedKeysLower}
          previewEvent={finalEvent}
          mappedSampleEvent={mappedBase}
          validationIssues={validationIssues}
          previewWarnings={previewWarnings}
          validationLoading={validationLoading}
        />

        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-5rem)] xl:self-start xl:overflow-y-auto">
          <PanelChrome title="Final Event Preview" className="max-h-[min(46vh,480px)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-2.5 py-2 dark:border-gdc-border">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  Live
                </span>
                {previewLoading ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Updating…
                  </span>
                ) : null}
                {!previewLoading && previewWarnings.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200"
                    title={previewWarnings.map((w) => w.message).join('; ')}
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {previewWarnings.length} preview warning{previewWarnings.length === 1 ? '' : 's'}
                  </span>
                ) : null}
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
            {previewError ? (
              <p className="border-b border-amber-200/80 bg-amber-50/80 px-2.5 py-2 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                {previewError}
              </p>
            ) : null}
            {!previewError && previewWarnings.length > 0 ? (
              <ul className="border-b border-amber-200/60 bg-amber-50/60 px-2.5 py-2 text-[10px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/25 dark:text-amber-100">
                {previewWarnings.map((w, idx) => (
                  <li key={`${w.code}-${w.target_field ?? idx}`}>
                    <span className="font-mono font-semibold">{w.code}</span>
                    {w.target_field ? (
                      <span className="text-amber-700 dark:text-amber-300"> · {w.target_field}</span>
                    ) : null}
                    {' — '}
                    {w.message}
                  </li>
                ))}
              </ul>
            ) : null}
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
              Server-side enrichment preview (same engine as runtime). KEEP_EXISTING: overlapping keys keep mapped values.
            </p>
          </PanelChrome>

          <section className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h4 className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Enrichment Summary</h4>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:justify-between">
              <ul className="min-w-0 flex-1 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200">
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Static rules</span>
                  <span className="font-semibold">{summary.typeCounts.static}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Calculated</span>
                  <span className="font-semibold">{summary.typeCounts.calculated}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Lookup / Conditional / Normalize</span>
                  <span className="font-semibold">
                    {summary.typeCounts.lookup + summary.typeCounts.conditional + summary.typeCounts.normalize}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Auto (template) fields</span>
                  <span className="font-semibold">{summary.autoN}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-slate-500">Total active rules</span>
                  <span className="font-semibold text-violet-700 dark:text-violet-300">{summary.total}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span
                    className="text-slate-500"
                    title="Enrichment keys that match mapped output keys are not applied when override policy is KEEP_EXISTING."
                  >
                    Skipped (mapped key exists)
                  </span>
                  <span className="font-semibold">{summary.mappedConflicts}</span>
                </li>
                <li className="flex justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-gdc-border">
                  <span className="text-slate-500">Validation errors</span>
                  <span className="font-semibold">{validationErrorCount}</span>
                </li>
                <li className="flex justify-between gap-2">
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
                {duplicateEnrichmentKeys.size > 0 ? (
                  <p className="mt-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    Duplicate field names detected
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <p className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gdc-muted">
            <Info className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            Advanced rules are stored under <span className="font-mono">__rules</span> and executed by the runtime enrichment engine.
          </p>
        </div>
      </div>
    </div>
  )
}
