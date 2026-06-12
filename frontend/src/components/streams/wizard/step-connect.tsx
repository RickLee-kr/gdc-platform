import { useCallback } from 'react'
import { cn } from '../../../lib/utils'
import { resolveSourceTypePresentation } from '../../../utils/sourceTypePresentation'
import { ConnectJsonPreviewPanel } from './connect-json-preview-panel'
import { RecordSelectionWorkspace } from './record-selection-workspace'
import { StepApiTest } from './step-api-test'
import { StepConfig } from './step-config'
import { StepSource } from './step-source'
import type { WizardConfigState, WizardState } from './wizard-state'

type ConnectTabKey = 'connection' | 'api_test' | 'preview' | 'record_selection'
import type { OperationalSampleId } from './wizard-operational-samples'

export type StepConnectProps = {
  state: WizardState
  activeTab: ConnectTabKey
  onTabChange: (tab: ConnectTabKey) => void
  onConnectorChange: (patch: Partial<WizardState['connector']>) => void
  onStreamChange: (patch: Partial<WizardState['stream']>) => void
  onApiTestChange: (next: WizardState['apiTest']) => void
  onStreamPatch: (patch: Partial<WizardConfigState>) => void
  onSetEventArrayPath: (path: string) => void
  onSetEventRootPath: (path: string) => void
  onSetCheckpoint: (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => void
  onLoadOperationalSample?: (id: OperationalSampleId) => void
  activeOperationalSampleId?: OperationalSampleId | null
}

const TAB_DEFS: ReadonlyArray<{ key: ConnectTabKey; label: string }> = [
  { key: 'connection', label: 'Connection' },
  { key: 'api_test', label: 'API Test' },
  { key: 'preview', label: 'Preview' },
  { key: 'record_selection', label: 'Record Selection' },
]

export function StepConnect({
  state,
  activeTab,
  onTabChange,
  onConnectorChange,
  onStreamChange,
  onApiTestChange,
  onStreamPatch,
  onSetEventArrayPath,
  onSetEventRootPath,
  onSetCheckpoint,
  onLoadOperationalSample,
  activeOperationalSampleId,
}: StepConnectProps) {
  const sourcePres = resolveSourceTypePresentation(state.connector.sourceType)
  const apiTestLabel = sourcePres.wizard.apiTestStepTitle

  const tabs = TAB_DEFS.map((tab) =>
    tab.key === 'api_test' ? { ...tab, label: apiTestLabel } : tab,
  )

  const advanceToRecordSelection = useCallback(() => {
    onTabChange('record_selection')
    window.requestAnimationFrame(() => {
      document.getElementById('wizard-json-preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [onTabChange])

  return (
    <div className="space-y-4" data-testid="wizard-step-connect">
      <header className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Connect</h3>
        <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Choose a source, verify the connection, preview the response, and select which records to send downstream.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-slate-200/80 bg-slate-50/80 p-1 dark:border-gdc-border dark:bg-gdc-card"
        aria-label="Connect sections"
        data-testid="wizard-connect-tabs"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`wizard-connect-tab-${tab.key}`}
              onClick={() => onTabChange(tab.key)}
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
        {activeTab === 'connection' ? (
          <div className="space-y-4">
            <StepSource state={state} onChange={onConnectorChange} />
            <StepConfig state={state} onChange={onStreamChange} />
          </div>
        ) : null}
        {activeTab === 'api_test' ? (
          <StepApiTest
            state={state}
            onChange={onApiTestChange}
            onStreamPatch={onStreamPatch}
            onLoadOperationalSample={onLoadOperationalSample}
            activeOperationalSampleId={activeOperationalSampleId}
            onAdvanceToPreview={advanceToRecordSelection}
          />
        ) : null}
        {activeTab === 'preview' ? <ConnectJsonPreviewPanel state={state} /> : null}
        {activeTab === 'record_selection' ? (
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
