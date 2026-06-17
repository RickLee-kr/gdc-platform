import { useEffect, useMemo, useRef, useState } from 'react'
import { EnrichmentAddFieldMenu } from './enrichment-add-field-menu'
import { EnrichmentRulesEditor } from './enrichment-rules-editor'
import type { WizardEnrichmentRule } from './enrichment-rules-model'
import { WizardBasicMappingPanel } from './wizard-basic-mapping-panel'
import { WizardFullEventTransformWorkspace } from './wizard-full-event-transform-workspace'
import { buildMappedBaseFromState } from './wizard-review-preview'
import type { WizardDataProtectionState, WizardMappingRow, WizardState } from './wizard-state'
import { WizardTransformDataProtectionCard } from './wizard-transform-data-protection-card'
import { wizardTransformSampleReady } from './wizard-transform-sample'

export type StepMappingCombinedProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeMappingMode: (mode: WizardState['mappingMode']) => void
  onChangeFullEventJsonata: (expression: string) => void
  onChangeFullEventRegexConfigJson: (json: string) => void
  onChangeEnrichment: (rules: WizardEnrichmentRule[]) => void
  onChangeDataProtection: (patch: Partial<WizardDataProtectionState>) => void
  dataProtectionDrawerOpen?: boolean
  onDataProtectionDrawerOpenChange?: (open: boolean) => void
}

type MappingModeTab = 'basic' | 'advanced' | 'expert'

/**
 * v3 Transform step body — restored from 206f0f7 Mapping step (Basic · JSONPath / Advanced · JSONata / Expert · Regex).
 */
export function StepMappingCombined({
  state,
  onChangeMapping,
  onChangeMappingMode,
  onChangeFullEventJsonata,
  onChangeFullEventRegexConfigJson,
  onChangeEnrichment,
  onChangeDataProtection,
  dataProtectionDrawerOpen,
  onDataProtectionDrawerOpenChange,
}: StepMappingCombinedProps) {
  const [modeTab, setModeTab] = useState<MappingModeTab>(() => {
    if (state.mappingMode === 'full_event_jsonata') return 'advanced'
    if (state.mappingMode === 'full_event_regex') return 'expert'
    return 'basic'
  })

  const mappingModeRef = useRef(state.mappingMode)
  useEffect(() => {
    const prev = mappingModeRef.current
    mappingModeRef.current = state.mappingMode
    if (prev === state.mappingMode) return
    if (state.mappingMode === 'full_event_jsonata') setModeTab('advanced')
    else if (state.mappingMode === 'full_event_regex') setModeTab('expert')
    else setModeTab('basic')
  }, [state.mappingMode])

  const sampleEvent = useMemo(() => {
    const events = state.apiTest.extractedEvents
    if (!events || events.length === 0) return null
    const first = events[0]
    return first && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null
  }, [state.apiTest.extractedEvents])

  const mappedBase = useMemo(
    () => buildMappedBaseFromState(sampleEvent, state.mapping),
    [sampleEvent, state.mapping],
  )

  const mappedKeysLower = useMemo(() => {
    const keys = new Set<string>()
    for (const key of Object.keys(mappedBase)) keys.add(key.toLowerCase())
    return keys
  }, [mappedBase])

  const modeTabClass = (tab: MappingModeTab) =>
    modeTab === tab
      ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-gdc-muted'

  if (!wizardTransformSampleReady(state)) {
    return (
      <section
        className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card"
        data-testid="wizard-step-transform"
      >
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Transform</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Complete <span className="font-semibold">Sample &amp; Record Selection</span> first — transform uses the confirmed
          record path and checkpoint from your sample fetch.
        </p>
      </section>
    )
  }

  return (
    <div data-testid="wizard-step-transform">
      <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <p className="text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Map fields from the sample event to your output schema. Click a field in the JSON to add it to the mapping.
        </p>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-b border-slate-200/80 dark:border-gdc-border">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Transform mode">
            <button
              type="button"
              role="tab"
              aria-selected={modeTab === 'basic'}
              className={`-mb-px border-b-2 px-3 pb-2 text-[12px] font-semibold ${modeTabClass('basic')}`}
              onClick={() => {
                setModeTab('basic')
                onChangeMappingMode('basic_jsonpath')
              }}
            >
              Basic · JSONPath
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modeTab === 'advanced'}
              className={`-mb-px border-b-2 px-3 pb-2 text-[12px] font-semibold ${modeTabClass('advanced')}`}
              onClick={() => {
                setModeTab('advanced')
                onChangeMappingMode('full_event_jsonata')
              }}
            >
              Advanced · JSONata
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modeTab === 'expert'}
              className={`-mb-px border-b-2 px-3 pb-2 text-[12px] font-semibold ${modeTabClass('expert')}`}
              onClick={() => {
                setModeTab('expert')
                onChangeMappingMode('full_event_regex')
              }}
            >
              Expert · Regex
            </button>
          </div>
          <EnrichmentAddFieldMenu
            rules={state.enrichment}
            onRulesChange={onChangeEnrichment}
            className="-mb-px pb-2"
          />
        </div>

        {modeTab === 'basic' ? (
          <WizardBasicMappingPanel state={state} onChangeMapping={onChangeMapping} />
        ) : (
          <div className="mt-4">
            <WizardFullEventTransformWorkspace
              sampleEvent={sampleEvent}
              unionSchema={state.apiTest.unionSchema}
              enrichment={state.enrichment}
              eventCount={state.apiTest.eventCount}
              jsonataExpression={state.fullEventJsonataExpression}
              onJsonataExpressionChange={onChangeFullEventJsonata}
              fullEventRegexConfigJson={state.fullEventRegexConfigJson}
              onFullEventRegexConfigJsonChange={onChangeFullEventRegexConfigJson}
              filterUiMode={modeTab === 'expert' ? 'expert' : 'advanced'}
            />
          </div>
        )}

        <div className="mt-4">
          <EnrichmentRulesEditor
            rules={state.enrichment}
            onChange={onChangeEnrichment}
            mappedKeysLower={mappedKeysLower}
            mappedSampleEvent={mappedBase}
            hideAddMenu
            data-testid="wizard-transform-enrichment-editor"
          />
        </div>
      </section>

      <div className="mt-4">
        <WizardTransformDataProtectionCard
          state={state}
          onChange={onChangeDataProtection}
          drawerOpen={dataProtectionDrawerOpen}
          onDrawerOpenChange={onDataProtectionDrawerOpenChange}
        />
      </div>
    </div>
  )
}
