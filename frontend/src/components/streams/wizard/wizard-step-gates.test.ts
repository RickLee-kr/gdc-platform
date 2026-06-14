import { describe, expect, it } from 'vitest'
import {
  applySampleConfirmationToWizardState,
  canAdvanceFromWizardStep,
  resolveHttpApiTestResult,
  sampleConfirmationPatch,
  wizardApiTestReady,
  wizardCheckpointConfirmed,
  wizardCheckpointStale,
  wizardDestinationGateReady,
  wizardRecordPathConfirmed,
  wizardRecordPathReady,
  wizardRecordPathStale,
  wizardSampleStepBlockReason,
  wizardSampleStepGateReady,
  wizardStepReachable,
  wizardSyncPositionReady,
} from './wizard-step-gates'
import { buildInitialState } from './wizard-state'

function sampleReadyState() {
  const state = buildInitialState()
  const finishedAt = Date.now()
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.statusCode = 200
  state.apiTest.parsedJson = { events: [{ id: '1', ts: 100 }] }
  state.apiTest.rawResponse = state.apiTest.parsedJson
  state.apiTest.finishedAt = finishedAt
  state.stream.eventArrayPath = '$.events'
  state.stream.checkpointSourcePath = '$.ts'
  state.stream.recordPathConfirmedForApiTestAt = finishedAt
  state.stream.checkpointConfirmedForApiTestAt = finishedAt
  return state
}

describe('wizard-step-gates', () => {
  it('requires record path and sync position on sample step', () => {
    const state = buildInitialState()
    expect(wizardRecordPathReady(state)).toBe(false)
    expect(wizardSyncPositionReady(state)).toBe(false)
    expect(wizardSampleStepGateReady(state)).toBe(false)
    expect(canAdvanceFromWizardStep('sample', state)).toBe(false)

    state.stream.useWholeResponseAsEvent = true
    expect(wizardRecordPathReady(state)).toBe(true)
    expect(canAdvanceFromWizardStep('sample', state)).toBe(false)

    state.stream.checkpointSourcePath = '$.timestamp'
    expect(wizardSyncPositionReady(state)).toBe(true)
    expect(wizardSampleStepGateReady(state)).toBe(false)
    expect(canAdvanceFromWizardStep('sample', state)).toBe(false)
  })

  it('requires confirmed selections tied to the latest successful API test', () => {
    const state = sampleReadyState()
    expect(wizardSampleStepGateReady(state)).toBe(true)
    expect(canAdvanceFromWizardStep('sample', state)).toBe(true)

    state.stream.recordPathConfirmedForApiTestAt = null
    expect(wizardRecordPathStale(state)).toBe(true)
    expect(wizardSampleStepGateReady(state)).toBe(false)
  })

  it('blocks sample gate when API test fails', () => {
    const state = sampleReadyState()
    state.apiTest.status = 'error'
    state.apiTest.ok = false
    expect(wizardApiTestReady(state)).toBe(false)
    expect(wizardSampleStepGateReady(state)).toBe(false)
    expect(canAdvanceFromWizardStep('sample', state)).toBe(false)
  })

  it('blocks sample gate while API test is running', () => {
    const state = sampleReadyState()
    state.apiTest.status = 'running'
    state.apiTest.finishedAt = null
    expect(wizardApiTestReady(state)).toBe(false)
    expect(wizardSampleStepGateReady(state)).toBe(false)
  })

  it('treats HTTP 400/500 as not sample-ready', () => {
    expect(resolveHttpApiTestResult(400, true)).toEqual({ status: 'error', ok: false })
    expect(resolveHttpApiTestResult(500, true)).toEqual({ status: 'error', ok: false })

    const state = sampleReadyState()
    state.apiTest.statusCode = 500
    expect(wizardApiTestReady(state)).toBe(false)
    expect(wizardSampleStepGateReady(state)).toBe(false)
  })

  it('requires at least one enabled delivery path on destinations step', () => {
    const state = buildInitialState()
    expect(wizardDestinationGateReady(state)).toBe(false)
    expect(canAdvanceFromWizardStep('destinations', state)).toBe(false)

    state.destinations.routeDrafts = [
      {
        key: 'r1',
        destinationId: 1,
        enabled: false,
        failurePolicy: 'RETRY_THEN_DLQ',
        rateLimitJson: {},
      },
    ]
    expect(wizardDestinationGateReady(state)).toBe(false)

    state.destinations.routeDrafts[0]!.enabled = true
    expect(wizardDestinationGateReady(state)).toBe(true)
    expect(canAdvanceFromWizardStep('destinations', state)).toBe(true)
  })

  it('blocks unreachable stepper targets until prior gates pass', () => {
    const state = buildInitialState()
    expect(wizardStepReachable('transform', state)).toBe(false)
    expect(wizardStepReachable('deploy', state)).toBe(false)

    const ready = sampleReadyState()
    expect(wizardStepReachable('transform', ready)).toBe(true)
    expect(wizardStepReachable('deploy', ready)).toBe(false)

    ready.destinations.routeDrafts = [
      {
        key: 'r1',
        destinationId: 1,
        enabled: true,
        failurePolicy: 'RETRY_THEN_DLQ',
        rateLimitJson: {},
      },
    ]
    expect(wizardStepReachable('deploy', ready)).toBe(true)
  })

  it('marks stale checkpoint when path exists but is not reconfirmed', () => {
    const state = sampleReadyState()
    state.stream.checkpointConfirmedForApiTestAt = null
    expect(wizardCheckpointConfirmed(state)).toBe(false)
    expect(wizardCheckpointStale(state)).toBe(true)
    expect(wizardRecordPathConfirmed(state)).toBe(true)
  })

  it('auto-stamps confirmations when paths are set and the API test succeeded', () => {
    const state = buildInitialState()
    const finishedAt = Date.now()
    state.apiTest.status = 'success'
    state.apiTest.ok = true
    state.apiTest.statusCode = 200
    state.apiTest.parsedJson = { events: [{ id: '1', ts: 100 }] }
    state.apiTest.rawResponse = state.apiTest.parsedJson
    state.apiTest.finishedAt = finishedAt
    state.stream.eventArrayPath = '$.events'
    state.stream.checkpointSourcePath = '$.ts'

    const patch = sampleConfirmationPatch(state.stream, state.apiTest)
    expect(patch.recordPathConfirmedForApiTestAt).toBe(finishedAt)
    expect(patch.checkpointConfirmedForApiTestAt).toBe(finishedAt)
    expect(wizardSampleStepGateReady(applySampleConfirmationToWizardState(state))).toBe(true)
  })

  it('clears confirmations when the API test is not successful', () => {
    const state = sampleReadyState()
    state.apiTest.status = 'error'
    state.apiTest.ok = false

    const patch = sampleConfirmationPatch(state.stream, state.apiTest)
    expect(patch.recordPathConfirmedForApiTestAt).toBeNull()
    expect(patch.checkpointConfirmedForApiTestAt).toBeNull()
  })

  it('describes missing sample-step requirements for the Next control', () => {
    const state = buildInitialState()
    expect(wizardSampleStepBlockReason(state)).toMatch(/Run a successful API Test/i)

    const ready = sampleReadyState()
    ready.stream.checkpointSourcePath = ''
    expect(wizardSampleStepBlockReason(ready)).toMatch(/Sync Position/i)
  })
})
