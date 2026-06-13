import { describe, expect, it } from 'vitest'
import {
  legacySubstepToWizardStep,
  migrateLegacyStepIndex,
  WIZARD_STEPS,
  computeLegacySubstepCompletion,
  computeStepCompletion,
  buildInitialState,
} from './wizard-state'
import {
  parseWizardDraftV2,
  WIZARD_DRAFT_KEY_V1,
  WIZARD_DRAFT_KEY_V2,
  WIZARD_DRAFT_VERSION,
  saveWizardDraft,
  clearWizardDraft,
  stateForDraftPersistence,
} from './wizard-draft-migration'

describe('wizard-state v3 WIZARD_STEPS', () => {
  it('exposes 6 top-level stepper keys', () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      'connect',
      'sample',
      'transform',
      'data_protection',
      'destinations',
      'deploy',
    ])
  })
})

describe('legacySubstepToWizardStep', () => {
  it('maps legacy substeps to v3 steps', () => {
    expect(legacySubstepToWizardStep('connector')).toBe('connect')
    expect(legacySubstepToWizardStep('api_test')).toBe('connect')
    expect(legacySubstepToWizardStep('preview')).toBe('sample')
    expect(legacySubstepToWizardStep('mapping')).toBe('transform')
    expect(legacySubstepToWizardStep('enrichment')).toBe('transform')
    expect(legacySubstepToWizardStep('data_protection')).toBe('data_protection')
    expect(legacySubstepToWizardStep('destinations')).toBe('destinations')
    expect(legacySubstepToWizardStep('review')).toBe('deploy')
    expect(legacySubstepToWizardStep('done')).toBe('deploy')
  })
})

describe('migrateLegacyStepIndex', () => {
  it('maps legacy 9-step indices to v3 6-step indices', () => {
    expect(migrateLegacyStepIndex(0)).toBe(0)
    expect(migrateLegacyStepIndex(2)).toBe(0)
    expect(migrateLegacyStepIndex(3)).toBe(1)
    expect(migrateLegacyStepIndex(4)).toBe(2)
    expect(migrateLegacyStepIndex(6)).toBe(3)
    expect(migrateLegacyStepIndex(7)).toBe(4)
    expect(migrateLegacyStepIndex(8)).toBe(5)
  })
})

describe('computeStepCompletion v3 aggregation', () => {
  it('aggregates legacy substeps into six top-level steps', () => {
    const state = buildInitialState()
    const finishedAt = Date.now()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.apiTest.ok = true
    state.apiTest.parsedJson = { id: 'evt-1' }
    state.apiTest.finishedAt = finishedAt
    state.apiTest.eventCount = 1
    state.stream.useWholeResponseAsEvent = true
    state.stream.checkpointSourcePath = '$.ts'
    state.stream.recordPathConfirmedForApiTestAt = finishedAt
    state.stream.checkpointConfirmedForApiTestAt = finishedAt
    state.mapping = [{ id: 'm1', outputField: 'id', sourceJsonPath: '$.id' }]

    const legacy = computeLegacySubstepCompletion(state)
    const v3 = computeStepCompletion(state)

    expect(legacy.connector).toBe('complete')
    expect(v3.connect).toBe('complete')
    expect(v3.sample).toBe('complete')
    expect(v3.transform).toBe('in_progress')
    expect(v3.data_protection).toBe('complete')
  })
})

describe('wizard-draft-migration', () => {
  it('migrates v1 draft envelope to v2 with stepKey', () => {
    const state = buildInitialState()
    state.stream.name = 'Draft stream'
    const v1 = JSON.stringify({
      savedAt: 1,
      stepIndex: 4,
      state,
    })
    const parsed = parseWizardDraftV2(v1)
    expect(parsed?.version).toBe(WIZARD_DRAFT_VERSION)
    expect(parsed?.stepKey).toBe('transform')
    expect(parsed?.state.stream.name).toBe('Draft stream')
  })

  it('reads v2 draft envelope directly', () => {
    const state = buildInitialState()
    const v2 = JSON.stringify({
      version: WIZARD_DRAFT_VERSION,
      savedAt: 2,
      stepKey: 'sample',
      state,
    })
    const parsed = parseWizardDraftV2(v2)
    expect(parsed?.stepKey).toBe('sample')
  })

  it('migrates legacy stepIndex 6 to data_protection (not destinations)', () => {
    const state = buildInitialState()
    const v1 = JSON.stringify({
      savedAt: 1,
      stepIndex: 6,
      state,
    })
    const parsed = parseWizardDraftV2(v1)
    expect(parsed?.stepKey).toBe('data_protection')
  })

  it('does not persist outcome.streamId into reusable draft', () => {
    const state = buildInitialState()
    state.outcome = {
      streamId: 42,
      routeId: 1,
      routeIds: [1],
      mappingSaved: true,
      enrichmentSaved: false,
      dataProtectionSaved: false,
      dataProtectionEnforcementIncomplete: false,
      dataProtectionWarnings: [],
      errors: [],
      apiBacked: true,
      createdAt: null,
      materializedStreamIds: [],
    }
    localStorage.setItem('gdc-stream-wizard-draft-v2', '')
    saveWizardDraft(state, 'deploy')
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY_V2)
    expect(raw).toBeTruthy()
    const parsed = parseWizardDraftV2(raw!)
    expect(parsed?.state.outcome?.streamId ?? null).toBeNull()
  })

  it('stateForDraftPersistence strips stream creation outcome', () => {
    const state = buildInitialState()
    state.outcome = {
      streamId: 99,
      routeId: null,
      routeIds: [],
      mappingSaved: false,
      enrichmentSaved: false,
      dataProtectionSaved: false,
      dataProtectionEnforcementIncomplete: false,
      dataProtectionWarnings: [],
      errors: [],
      apiBacked: true,
      createdAt: null,
      materializedStreamIds: [],
    }
    expect(stateForDraftPersistence(state).outcome).toBeNull()
  })

  it('clearWizardDraft removes v1 and v2 keys', () => {
    localStorage.setItem(WIZARD_DRAFT_KEY_V1, '{}')
    localStorage.setItem(WIZARD_DRAFT_KEY_V2, '{}')
    clearWizardDraft()
    expect(localStorage.getItem(WIZARD_DRAFT_KEY_V1)).toBeNull()
    expect(localStorage.getItem(WIZARD_DRAFT_KEY_V2)).toBeNull()
  })

  it('exports stable draft key constants', () => {
    expect(WIZARD_DRAFT_KEY_V1).toBe('gdc-stream-wizard-draft-v1')
    expect(migrateLegacyStepIndex(7)).toBe(4)
  })
})
