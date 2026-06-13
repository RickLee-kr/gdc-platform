import type { WizardState, WizardStepKey } from './wizard-state'

const WIZARD_STEP_ORDER: readonly WizardStepKey[] = [
  'connect',
  'sample',
  'transform',
  'data_protection',
  'destinations',
  'deploy',
]

/** Whether the latest API test returned a usable response payload. */
export function wizardApiTestHasResponsePayload(state: Pick<WizardState, 'apiTest'>): boolean {
  const payload = state.apiTest.parsedJson ?? state.apiTest.rawResponse
  return payload != null
}

/** HTTP status >= 400 must not satisfy sample readiness. */
export function wizardApiTestHttpStatusOk(state: Pick<WizardState, 'apiTest'>): boolean {
  const code = state.apiTest.statusCode
  return code == null || code < 400
}

/** Latest API test result is authoritative — success + ok + payload + HTTP < 400. */
export function wizardApiTestReady(state: Pick<WizardState, 'apiTest'>): boolean {
  const t = state.apiTest
  if (t.status !== 'success' || !t.ok) return false
  if (!wizardApiTestHasResponsePayload(state)) return false
  return wizardApiTestHttpStatusOk(state)
}

/** Resolve HTTP API test status from response metadata (shared by runtime UI + tests). */
export function resolveHttpApiTestResult(
  statusCode: number | null | undefined,
  hasPayload: boolean,
): { status: 'success' | 'error'; ok: boolean } {
  if (statusCode != null && statusCode >= 400) {
    return { status: 'error', ok: false }
  }
  if (!hasPayload) {
    return { status: 'error', ok: false }
  }
  return { status: 'success', ok: true }
}

/** Record path selected (whole response or explicit array path). */
export function wizardRecordPathReady(state: Pick<WizardState, 'stream'>): boolean {
  return state.stream.useWholeResponseAsEvent || state.stream.eventArrayPath.trim().length > 0
}

/** Sync position field selected on the sample record. */
export function wizardSyncPositionReady(state: Pick<WizardState, 'stream'>): boolean {
  return state.stream.checkpointSourcePath.trim().length > 0
}

/** Record path confirmed against the latest successful API test run. */
export function wizardRecordPathConfirmed(state: Pick<WizardState, 'stream' | 'apiTest'>): boolean {
  if (!wizardRecordPathReady(state)) return false
  const finishedAt = state.apiTest.finishedAt
  if (finishedAt == null) return false
  return state.stream.recordPathConfirmedForApiTestAt === finishedAt
}

/** Sync position confirmed against the latest successful API test run. */
export function wizardCheckpointConfirmed(state: Pick<WizardState, 'stream' | 'apiTest'>): boolean {
  if (!wizardSyncPositionReady(state)) return false
  const finishedAt = state.apiTest.finishedAt
  if (finishedAt == null) return false
  return state.stream.checkpointConfirmedForApiTestAt === finishedAt
}

/** Path is set but not reconfirmed for the current API test sample. */
export function wizardRecordPathStale(state: Pick<WizardState, 'stream' | 'apiTest'>): boolean {
  return wizardRecordPathReady(state) && !wizardRecordPathConfirmed(state)
}

/** Checkpoint is set but not reconfirmed for the current API test sample. */
export function wizardCheckpointStale(state: Pick<WizardState, 'stream' | 'apiTest'>): boolean {
  return wizardSyncPositionReady(state) && !wizardCheckpointConfirmed(state)
}

/** Sample step gate — latest API test + confirmed record path + confirmed sync position. */
export function wizardSampleStepGateReady(state: WizardState): boolean {
  return wizardApiTestReady(state) && wizardRecordPathConfirmed(state) && wizardCheckpointConfirmed(state)
}

/** At least one enabled delivery path before Deploy. */
export function wizardDestinationGateReady(state: Pick<WizardState, 'destinations'>): boolean {
  return state.destinations.routeDrafts.some((route) => route.enabled)
}

/** Whether the wizard may advance from the current top-level step. */
export function canAdvanceFromWizardStep(stepKey: WizardStepKey, state: WizardState): boolean {
  switch (stepKey) {
    case 'sample':
      return wizardSampleStepGateReady(state)
    case 'destinations':
      return wizardDestinationGateReady(state)
    default:
      return true
  }
}

/** Whether a stepper target is reachable (all prior required gates satisfied). */
export function wizardStepReachable(stepKey: WizardStepKey, state: WizardState): boolean {
  const targetIdx = WIZARD_STEP_ORDER.indexOf(stepKey)
  if (targetIdx < 0) return false
  for (let i = 0; i < targetIdx; i++) {
    const prior = WIZARD_STEP_ORDER[i]
    if (!canAdvanceFromWizardStep(prior, state)) return false
  }
  if (stepKey === 'deploy' && !wizardDestinationGateReady(state)) return false
  return true
}
