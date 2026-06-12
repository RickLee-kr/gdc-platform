import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdvancedTransformRuleDraft } from '../../../types/advancedTransform'
import { WizardBasicMappingPanel } from './wizard-basic-mapping-panel'
import { WizardFullEventTransformWorkspace } from './wizard-full-event-transform-workspace'
import type { WizardMappingRow, WizardState } from './wizard-state'

type StepMappingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
  onChangeMappingMode: (mode: WizardState['mappingMode']) => void
  onChangeFullEventJsonata: (expression: string) => void
  onChangeFullEventRegexConfigJson: (json: string) => void
  transformRules: AdvancedTransformRuleDraft[]
  onChangeTransformRules: (rules: AdvancedTransformRuleDraft[]) => void
}

type MappingModeTab = 'basic' | 'advanced' | 'expert'

function hasWizardMappingSample(state: WizardState): boolean {
  const t = state.apiTest
  return t.status === 'success' && (t.parsedJson ?? t.rawResponse) != null
}

export function StepMapping({
  state,
  onChangeMapping,
  onChangeMappingMode,
  onChangeFullEventJsonata,
  onChangeFullEventRegexConfigJson,
  transformRules: _transformRules,
  onChangeTransformRules: _onChangeTransformRules,
}: StepMappingProps) {
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

  const modeTabClass = (tab: MappingModeTab) =>
    modeTab === tab
      ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-gdc-muted'

  if (!hasWizardMappingSample(state)) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Field Mapping</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Complete <span className="font-semibold">JSON Preview</span> first — mapping uses the extracted sample from API Test.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <p className="text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
        Map fields from the sample event to your output schema. Click a field in the JSON to add it to the mapping.
      </p>

      <div
        className="mt-4 flex flex-wrap gap-1 border-b border-slate-200/80 dark:border-gdc-border"
        role="tablist"
        aria-label="Mapping mode"
      >
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
          Expert · Full Event Regex
        </button>
      </div>

      {modeTab === 'basic' ? (
        <WizardBasicMappingPanel state={state} onChangeMapping={onChangeMapping} />
      ) : (
        <div className="mt-4">
          <WizardFullEventTransformWorkspace
            sampleEvent={sampleEvent}
            jsonataExpression={state.fullEventJsonataExpression}
            onJsonataExpressionChange={onChangeFullEventJsonata}
            fullEventRegexConfigJson={state.fullEventRegexConfigJson}
            onFullEventRegexConfigJsonChange={onChangeFullEventRegexConfigJson}
            filterUiMode={modeTab === 'expert' ? 'expert' : 'advanced'}
          />
        </div>
      )}
    </section>
  )
}
