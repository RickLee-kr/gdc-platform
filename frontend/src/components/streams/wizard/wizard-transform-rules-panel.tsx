import { useCallback, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import { TRANSFORM_FIELD_IMPORTANCE, TRANSFORM_FIELD_IMPORTANCE_HELP } from '../../../lib/field-importance'
import type { AdvancedTransformRuleDraft } from '../../../types/advancedTransform'
import { AdvancedTransformWorkspace } from '../../transform/advanced-transform-workspace'
import { FieldImportanceBadge } from './field-importance-badge'
import { EnrichmentRulesEditor } from './enrichment-rules-editor'
import type { WizardEnrichmentRule } from './enrichment-rules-model'
import { WizardFullEventTransformWorkspace } from './wizard-full-event-transform-workspace'

type TransformRulesTab = 'field_rules' | 'jsonata' | 'regex'

type WizardTransformRulesPanelProps = {
  sampleEvent: Record<string, unknown> | null
  enrichmentRules: WizardEnrichmentRule[]
  onEnrichmentChange: (rules: WizardEnrichmentRule[]) => void
  transformRules: AdvancedTransformRuleDraft[]
  onTransformRulesChange: (rules: AdvancedTransformRuleDraft[]) => void
  fullEventJsonata: string
  onFullEventJsonataChange: (expression: string) => void
  fullEventRegexConfigJson: string
  onFullEventRegexConfigJsonChange: (json: string) => void
  simpleFieldMappings: Record<string, string>
}

const TAB_DEFS: ReadonlyArray<{ key: TransformRulesTab; label: string; subtitle: string }> = [
  { key: 'field_rules', label: 'Field rules', subtitle: 'Static · calculated · conditional · normalize' },
  { key: 'jsonata', label: 'JSONata', subtitle: 'Per-field or full-event expressions' },
  { key: 'regex', label: 'Regex', subtitle: 'String extract · full-event config' },
]

export function WizardTransformRulesPanel({
  sampleEvent,
  enrichmentRules,
  onEnrichmentChange,
  transformRules,
  onTransformRulesChange,
  fullEventJsonata,
  onFullEventJsonataChange,
  fullEventRegexConfigJson,
  onFullEventRegexConfigJsonChange,
  simpleFieldMappings,
}: WizardTransformRulesPanelProps) {
  const [tab, setTab] = useState<TransformRulesTab>('field_rules')

  const enrichmentStatic = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const rule of enrichmentRules) {
      if (rule.enabled && rule.type === 'static' && rule.fieldName.trim()) {
        out[rule.fieldName.trim()] = rule.staticValue
      }
    }
    return out
  }, [enrichmentRules])

  const mappedKeysLower = useMemo(() => {
    const s = new Set<string>()
    for (const k of Object.keys(simpleFieldMappings)) s.add(k.toLowerCase())
    return s
  }, [simpleFieldMappings])

  const setTabSafe = useCallback((next: TransformRulesTab) => setTab(next), [])

  return (
    <div className="space-y-3" data-testid="wizard-transform-rules-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Transform rules</h4>
        <FieldImportanceBadge
          importance={TRANSFORM_FIELD_IMPORTANCE.transformRules}
          title={TRANSFORM_FIELD_IMPORTANCE_HELP.transformRules}
        />
      </div>

      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-slate-50/80 p-1 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Transform rule types"
      >
        {TAB_DEFS.map((item) => {
          const active = item.key === tab
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`wizard-transform-rules-tab-${item.key}`}
              onClick={() => setTabSafe(item.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-left transition-colors',
                active
                  ? 'bg-white text-violet-700 shadow-sm dark:bg-gdc-section dark:text-violet-300'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover dark:hover:text-slate-100',
              )}
            >
              <span className="block text-[12px] font-semibold">{item.label}</span>
              <span className="block text-[10px] font-medium opacity-80">{item.subtitle}</span>
            </button>
          )
        })}
      </nav>

      <div role="tabpanel">
        {tab === 'field_rules' ? (
          <EnrichmentRulesEditor
            rules={enrichmentRules}
            onChange={onEnrichmentChange}
            mappedKeysLower={mappedKeysLower}
            previewEvent={sampleEvent ?? undefined}
            excludeRuleTypes={['lookup']}
          />
        ) : null}
        {tab === 'jsonata' ? (
          <div className="space-y-4">
            <AdvancedTransformWorkspace
              stage="mapping"
              contextLabel="Transform"
              sampleEvent={sampleEvent}
              rules={transformRules}
              onRulesChange={onTransformRulesChange}
              simpleFieldMappings={simpleFieldMappings}
              enrichmentStatic={enrichmentStatic}
              filterUiMode="advanced"
            />
            <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card">
              <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Full-event JSONata</p>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                Replace the entire output object with one JSONata expression (alternative to field-by-field output).
              </p>
              <div className="mt-3">
                <WizardFullEventTransformWorkspace
                  sampleEvent={sampleEvent}
                  jsonataExpression={fullEventJsonata}
                  onJsonataExpressionChange={onFullEventJsonataChange}
                  fullEventRegexConfigJson={fullEventRegexConfigJson}
                  onFullEventRegexConfigJsonChange={onFullEventRegexConfigJsonChange}
                  filterUiMode="advanced"
                />
              </div>
            </div>
          </div>
        ) : null}
        {tab === 'regex' ? (
          <div className="space-y-4">
            <AdvancedTransformWorkspace
              stage="mapping"
              contextLabel="Transform"
              sampleEvent={sampleEvent}
              rules={transformRules}
              onRulesChange={onTransformRulesChange}
              simpleFieldMappings={simpleFieldMappings}
              enrichmentStatic={enrichmentStatic}
              filterUiMode="expert"
            />
            <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card">
              <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Full-event regex config</p>
              <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                Paste an external full-event regex transform JSON config and preview before save.
              </p>
              <div className="mt-3">
                <WizardFullEventTransformWorkspace
                  sampleEvent={sampleEvent}
                  jsonataExpression={fullEventJsonata}
                  onJsonataExpressionChange={onFullEventJsonataChange}
                  fullEventRegexConfigJson={fullEventRegexConfigJson}
                  onFullEventRegexConfigJsonChange={onFullEventRegexConfigJsonChange}
                  filterUiMode="expert"
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
