import { describe, expect, it } from 'vitest'
import { computeDeployReadiness } from './wizard-deploy-readiness'
import { buildInitialState } from './wizard-state'

function readyState() {
  const state = buildInitialState()
  const finishedAt = Date.now()
  state.connector.connectorId = 1
  state.connector.sourceId = 1
  state.connector.connectorName = 'Test Connector'
  state.stream.name = 'Test Stream'
  state.stream.endpoint = '/events'
  state.stream.eventArrayPath = '$.events'
  state.stream.checkpointSourcePath = '$.timestamp'
  state.stream.checkpointFieldType = 'datetime'
  state.stream.recordPathConfirmedForApiTestAt = finishedAt
  state.stream.checkpointConfirmedForApiTestAt = finishedAt
  state.apiTest.status = 'success'
  state.apiTest.ok = true
  state.apiTest.statusCode = 200
  state.apiTest.parsedJson = { events: [{ id: '1' }] }
  state.apiTest.finishedAt = finishedAt
  state.apiTest.eventCount = 2
  state.apiTest.extractedEvents = [{ id: '1' }]
  state.mapping = [{ id: 'm1', outputField: 'event_id', sourceJsonPath: '$.id' }]
  state.destinations.routeDrafts = [
    {
      key: 'r1',
      destinationId: 10,
      enabled: true,
      failurePolicy: 'RETRY_THEN_DLQ',
      rateLimitJson: '{}',
    },
  ]
  return state
}

describe('computeDeployReadiness', () => {
  it('returns READY when all checklist categories pass', () => {
    const snapshot = computeDeployReadiness(readyState(), { ok: true, failed: false, unknown: false })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.statusLabel).toBe('READY')
    expect(snapshot.canCreate).toBe(true)
    expect(snapshot.categories.map((c) => c.key)).toEqual([
      'connection',
      'data',
      'records',
      'transform',
      'protection',
      'delivery',
    ])
    expect(snapshot.categories.every((c) => c.tone === 'ok')).toBe(true)
  })

  it('returns NEEDS ATTENTION when required steps are incomplete', () => {
    const state = buildInitialState()
    const snapshot = computeDeployReadiness(state)
    expect(snapshot.status).toBe('needs_attention')
    expect(snapshot.statusLabel).toBe('NEEDS ATTENTION')
    expect(snapshot.canCreate).toBe(false)
    expect(snapshot.categories.some((c) => c.tone === 'err')).toBe(true)
  })

  it('returns READY WITH WARNINGS when field-level protection is pending runtime', () => {
    const state = readyState()
    state.dataProtection.intents = [
      {
        key: 'dp1',
        detectedField: '$.user.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'continue',
      },
    ]
    const snapshot = computeDeployReadiness(state, { ok: true, failed: false, unknown: false })
    expect(snapshot.status).toBe('ready_with_warnings')
    expect(snapshot.categories.find((c) => c.key === 'protection')?.tone).toBe('warn')
    expect(snapshot.canCreate).toBe(true)
  })

  it('returns NEEDS ATTENTION when delivery paths are disabled', () => {
    const state = readyState()
    state.destinations.routeDrafts[0]!.enabled = false
    const snapshot = computeDeployReadiness(state, { ok: true, failed: false, unknown: true })
    expect(snapshot.status).toBe('needs_attention')
    expect(snapshot.canCreate).toBe(false)
    expect(snapshot.categories.find((c) => c.key === 'delivery')?.tone).toBe('err')
  })

  it('returns NEEDS ATTENTION when sync position is missing', () => {
    const state = readyState()
    state.stream.checkpointSourcePath = ''
    state.stream.checkpointConfirmedForApiTestAt = null
    const snapshot = computeDeployReadiness(state)
    expect(snapshot.status).toBe('needs_attention')
    expect(snapshot.canCreate).toBe(false)
    expect(snapshot.categories.find((c) => c.key === 'records')?.tone).toBe('err')
  })

  it('returns NEEDS ATTENTION when latest API test failed', () => {
    const state = readyState()
    state.apiTest.status = 'error'
    state.apiTest.ok = false
    const snapshot = computeDeployReadiness(state)
    expect(snapshot.canCreate).toBe(false)
    expect(snapshot.categories.find((c) => c.key === 'data')?.tone).toBe('err')
  })
})
