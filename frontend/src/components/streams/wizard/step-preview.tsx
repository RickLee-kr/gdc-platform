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
  return <RecordSelectionWorkspace {...props} />
}
