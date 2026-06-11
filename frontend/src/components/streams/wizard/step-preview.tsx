import { RecordSelectionWorkspace } from './record-selection-workspace'
import type { WizardConfigState, WizardState } from './wizard-state'
import type { OperationalSampleId } from './wizard-operational-samples'

type StepPreviewProps = {
  state: WizardState
  onSetEventArrayPath: (path: string) => void
  onSetEventRootPath: (path: string) => void
  onSetCheckpoint: (patch: Partial<Pick<WizardConfigState, 'checkpointFieldType' | 'checkpointSourcePath'>>) => void
  onStreamPatch?: (patch: Partial<WizardConfigState>) => void
  onLoadOperationalSample?: (id: OperationalSampleId) => void
  activeOperationalSampleId?: OperationalSampleId | null
}

export function StepPreview(props: StepPreviewProps) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <RecordSelectionWorkspace {...props} />
    </section>
  )
}
