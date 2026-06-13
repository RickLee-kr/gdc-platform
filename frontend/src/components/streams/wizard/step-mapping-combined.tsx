import { useCallback, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import { TRANSFORM_FIELD_IMPORTANCE, TRANSFORM_FIELD_IMPORTANCE_HELP } from '../../../lib/field-importance'
import { fieldMappingsFromRows } from '../../../utils/mappingValidation'
import { MappingWorkspace } from '../../mappings/mapping-workspace'
import { FieldImportanceBadge } from './field-importance-badge'
import { MetadataMappingMenu } from './metadata-mapping-menu'
import type { WizardEnrichmentRow, WizardMappingRow, WizardState } from './wizard-state'
import { enrichmentDictFromRows } from './wizard-state'
import {
  buildWizardTransformSample,
  mappingModelRowsToWizard,
  wizardMappingRowsToModel,
  wizardTransformSampleReady,
} from './wizard-transform-sample'
import { WizardTransformRulesPanel } from './wizard-transform-rules-panel'

type TransformSectionKey = 'output_fields' | 'transform_rules' | 'output_verification'

export type StepMappingCombinedProps = {
  state: WizardState
  activeSection?: TransformSectionKey
  onSectionChange?: (section: TransformSectionKey) => void
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeMappingMode?: (mode: WizardState['mappingMode']) => void
  onChangeFullEventJsonata?: (expression: string) => void
  onChangeFullEventRegexConfigJson?: (json: string) => void
  onChangeEnrichment: (rows: WizardEnrichmentRow[]) => void
  onChangeTransformRules?: (rules: WizardState['transformRules']) => void
}

const SECTION_DEFS: ReadonlyArray<{ key: TransformSectionKey; label: string; subtitle: string; importance: keyof typeof TRANSFORM_FIELD_IMPORTANCE }> = [
  { key: 'output_fields', label: 'Output fields', subtitle: 'Source → output links · metadata profile', importance: 'outputFields' },
  { key: 'transform_rules', label: 'Transform rules', subtitle: 'Static · calculated · conditional · normalize · JSONata · regex', importance: 'transformRules' },
  { key: 'output_verification', label: 'Output verification', subtitle: 'Preview delivered event shape', importance: 'outputVerification' },
]

export function StepMappingCombined({
  state,
  activeSection: controlledSection,
  onSectionChange,
  onChangeMapping,
  onChangeMappingMode: _onChangeMappingMode,
  onChangeFullEventJsonata,
  onChangeFullEventRegexConfigJson,
  onChangeEnrichment,
  onChangeTransformRules,
}: StepMappingCombinedProps) {
  const [internalSection, setInternalSection] = useState<TransformSectionKey>('output_fields')
  const section = controlledSection ?? internalSection

  const setSection = useCallback(
    (next: TransformSectionKey) => {
      if (onSectionChange) onSectionChange(next)
      else setInternalSection(next)
    },
    [onSectionChange],
  )

  const sample = useMemo(() => buildWizardTransformSample(state), [state])
  const sampleReady = wizardTransformSampleReady(state)
  const initialRows = useMemo(() => wizardMappingRowsToModel(state.mapping), [state.mapping])
  const enrichment = useMemo(() => enrichmentDictFromRows(state.enrichment), [state.enrichment])
  const sampleEvent = sample?.extractedEvents?.[0] ?? null
  const simpleFieldMappings = useMemo(() => fieldMappingsFromRows(initialRows), [initialRows])

  const connectorLabel = state.connector.connectorName || state.connector.registryModuleId || 'Connector'
  const streamTitle = state.stream.name.trim() || 'New stream'

  if (!sampleReady) {
    return (
      <div className="space-y-4" data-testid="wizard-step-transform">
        <header className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Transform</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Complete <span className="font-semibold">Sample &amp; Record Selection</span> first — transform uses the confirmed
            record path and checkpoint from your sample fetch.
          </p>
        </header>
        <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
          <p className="text-[12px] text-slate-600 dark:text-gdc-muted">Run a sample fetch and confirm Record Path before transforming fields.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="wizard-step-transform">
      <header className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Transform</h3>
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Define output fields, apply transform rules, and verify the delivered event shape before data protection and
          destinations.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-slate-50/80 p-1 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Transform sections"
        data-testid="wizard-transform-sections"
      >
        {SECTION_DEFS.map((item) => {
          const active = item.key === section
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`wizard-transform-section-${item.key}`}
              onClick={() => setSection(item.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-left transition-colors',
                active
                  ? 'bg-white text-violet-700 shadow-sm dark:bg-gdc-section dark:text-violet-300'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover dark:hover:text-slate-100',
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="block text-[12px] font-semibold">{item.label}</span>
                <FieldImportanceBadge
                  importance={TRANSFORM_FIELD_IMPORTANCE[item.importance]}
                  title={TRANSFORM_FIELD_IMPORTANCE_HELP[item.importance]}
                />
              </span>
              <span className="block text-[10px] font-medium opacity-80">{item.subtitle}</span>
            </button>
          )
        })}
      </nav>

      <div role="tabpanel">
        {section === 'output_fields' ? (
          <MappingWorkspace
            streamId={null}
            streamTitle={streamTitle}
            connectorLabel={connectorLabel}
            sourceType={state.connector.sourceType}
            initialRows={initialRows}
            enrichment={enrichment}
            eventArrayPath={state.stream.eventArrayPath}
            eventRootPath={state.stream.eventRootPath}
            externalSample={sample}
            hideModeTabs
            forceModeTab="basic"
            layout="fields-only"
            hideEventArrayPathEditor
            onRowsChange={(rows) => onChangeMapping(mappingModelRowsToWizard(rows))}
            labels={{
              builderTitle: `Output fields (${initialRows.length})`,
              pickPathHint: 'Click a source field to add an output field link.',
            }}
            headerSlot={
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-gdc-border dark:bg-gdc-section">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Metadata profile</span>
                  <FieldImportanceBadge
                    importance={TRANSFORM_FIELD_IMPORTANCE.metadataProfile}
                    title={TRANSFORM_FIELD_IMPORTANCE_HELP.metadataProfile}
                  />
                </div>
                <MetadataMappingMenu state={state} onChangeMapping={onChangeMapping} />
              </div>
            }
          />
        ) : null}

        {section === 'transform_rules' ? (
          <WizardTransformRulesPanel
            sampleEvent={sampleEvent}
            enrichmentRules={state.enrichment}
            onEnrichmentChange={onChangeEnrichment}
            transformRules={state.transformRules}
            onTransformRulesChange={onChangeTransformRules ?? (() => {})}
            fullEventJsonata={state.fullEventJsonataExpression}
            onFullEventJsonataChange={onChangeFullEventJsonata ?? (() => {})}
            fullEventRegexConfigJson={state.fullEventRegexConfigJson}
            onFullEventRegexConfigJsonChange={onChangeFullEventRegexConfigJson ?? (() => {})}
            simpleFieldMappings={simpleFieldMappings}
          />
        ) : null}

        {section === 'output_verification' ? (
          <MappingWorkspace
            streamId={null}
            streamTitle={streamTitle}
            connectorLabel={connectorLabel}
            sourceType={state.connector.sourceType}
            initialRows={initialRows}
            enrichment={enrichment}
            eventArrayPath={state.stream.eventArrayPath}
            eventRootPath={state.stream.eventRootPath}
            externalSample={sample}
            hideModeTabs
            forceModeTab="basic"
            layout="preview-only"
            hideEventArrayPathEditor
            onRowsChange={(rows) => onChangeMapping(mappingModelRowsToWizard(rows))}
            transformRules={state.transformRules}
            onTransformRulesChange={onChangeTransformRules}
            headerSlot={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Delivered event preview</span>
                <FieldImportanceBadge
                  importance={TRANSFORM_FIELD_IMPORTANCE.outputVerification}
                  title={TRANSFORM_FIELD_IMPORTANCE_HELP.outputVerification}
                />
              </div>
            }
          />
        ) : null}
      </div>
    </div>
  )
}
