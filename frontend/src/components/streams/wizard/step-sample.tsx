import { useCallback, useState } from 'react'
import { cn } from '../../../lib/utils'
import { resolveSourceTypePresentation } from '../../../utils/sourceTypePresentation'
import { ConnectJsonPreviewPanel } from './connect-json-preview-panel'
import { RecordSelectionWorkspace } from './record-selection-workspace'
import { StepApiTest } from './step-api-test'
import type { WizardConfigState, WizardState } from './wizard-state'
import type { OperationalSampleId } from './wizard-operational-samples'

type SampleTabKey = 'run_test' | 'response' | 'record_path'

export type StepSampleProps = {
  state: WizardState
  activeTab?: SampleTabKey
  onTabChange?: (tab: SampleTabKey) => void
  onApiTestChange: (next: WizardState['apiTest']) => void
  onStreamPatch: (patch: Partial<WizardConfigState>) => void
  onSetEventArrayPath: (path: string) => void
  onSetEventRootPath: (path: string) => void
  onSetCheckpoint: (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => void
  onLoadOperationalSample?: (id: OperationalSampleId) => void
  activeOperationalSampleId?: OperationalSampleId | null
}

const TAB_DEFS: ReadonlyArray<{ key: SampleTabKey; label: string }> = [
  { key: 'run_test', label: 'Run Test' },
  { key: 'response', label: 'Response' },
  { key: 'record_path', label: 'Record Path' },
]

export function StepSample({
  state,
  activeTab: controlledTab,
  onTabChange,
  onApiTestChange,
  onStreamPatch,
  onSetEventArrayPath,
  onSetEventRootPath,
  onSetCheckpoint,
  onLoadOperationalSample,
  activeOperationalSampleId,
}: StepSampleProps) {
  const [internalTab, setInternalTab] = useState<SampleTabKey>('run_test')
  const activeTab = controlledTab ?? internalTab
  const sourcePres = resolveSourceTypePresentation(state.connector.sourceType)

  const setTab = useCallback(
    (next: SampleTabKey) => {
      if (onTabChange) onTabChange(next)
      else setInternalTab(next)
    },
    [onTabChange],
  )

  const advanceToRecordPath = useCallback(() => {
    setTab('record_path')
    window.requestAnimationFrame(() => {
      document.getElementById('wizard-json-preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [setTab])

  const tabs = TAB_DEFS.map((tab) =>
    tab.key === 'run_test' ? { ...tab, label: sourcePres.wizard.apiTestStepTitle } : tab,
  )

  return (
    <div className="space-y-4" data-testid="wizard-step-sample">
      <header className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Sample &amp; Record Selection
        </h3>
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Run a sample fetch, inspect the response, then confirm record path, event root, and checkpoint before
          transforming fields.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-slate-50/80 p-1 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Sample sections"
        data-testid="wizard-sample-tabs"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`wizard-sample-tab-${tab.key}`}
              onClick={() => setTab(tab.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors',
                active
                  ? 'bg-white text-violet-700 shadow-sm dark:bg-gdc-section dark:text-violet-300'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover dark:hover:text-slate-100',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <div role="tabpanel">
        {activeTab === 'run_test' ? (
          <StepApiTest
            state={state}
            onChange={onApiTestChange}
            onStreamPatch={onStreamPatch}
            onLoadOperationalSample={onLoadOperationalSample}
            activeOperationalSampleId={activeOperationalSampleId}
            onAdvanceToPreview={advanceToRecordPath}
          />
        ) : null}
        {activeTab === 'response' ? <ConnectJsonPreviewPanel state={state} /> : null}
        {activeTab === 'record_path' ? (
          <RecordSelectionWorkspace
            state={state}
            onSetEventArrayPath={onSetEventArrayPath}
            onSetEventRootPath={onSetEventRootPath}
            onSetCheckpoint={onSetCheckpoint}
            onStreamPatch={onStreamPatch}
            onLoadOperationalSample={onLoadOperationalSample}
            activeOperationalSampleId={activeOperationalSampleId}
          />
        ) : null}
      </div>
    </div>
  )
}
