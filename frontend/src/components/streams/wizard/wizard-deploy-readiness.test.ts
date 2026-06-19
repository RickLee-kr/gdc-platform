import { describe, expect, it } from 'vitest'
import { computeDeployReadiness, buildRouteProcessingSummary } from './wizard-deploy-readiness'
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
  state.apiTest.eventCount = 20
  state.apiTest.unionSchema = {
    total_events: 20,
    fields: [{ field_path: '$.id', field_type: 'string', occurrence_count: 20, sample_values: ['1'] }],
  }
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
      'route_processing',
      'delivery',
    ])
    expect(snapshot.categories.every((c) => c.tone === 'ok')).toBe(true)
  })

  it('buildRouteProcessingSummary reports global defaults', () => {
    const state = readyState()
    expect(buildRouteProcessingSummary(state)).toEqual({
      enabledRoutes: 1,
      totalRoutes: 1,
      transformLabel: 'Global default',
      protectionLabel: 'Global default',
      overrideRouteCount: 0,
    })
  })

  it('returns NEEDS ATTENTION when required steps are incomplete', () => {
    const state = buildInitialState()
    const snapshot = computeDeployReadiness(state)
    expect(snapshot.status).toBe('needs_attention')
    expect(snapshot.statusLabel).toBe('NEEDS ATTENTION')
    expect(snapshot.canCreate).toBe(false)
    expect(snapshot.categories.some((c) => c.tone === 'err')).toBe(true)
  })

  it('returns ok protection tone when field-level protection is configured', () => {
    const state = readyState()
    state.apiTest.extractedEvents = [{ user: { email: 'a@b.c' } }]
    state.mapping = [{ id: 'm1', outputField: 'email', sourceJsonPath: '$.user.email' }]
    state.dataProtection.intents = [
      {
        key: 'dp1',
        detectedField: '$.email',
        protectionAction: 'mask_partial',
        deliveryBehavior: 'continue',
      },
    ]
    const snapshot = computeDeployReadiness(state, { ok: true, failed: false, unknown: false })
    expect(snapshot.categories.find((c) => c.key === 'protection')?.tone).toBe('ok')
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

  it('shows needs-attention sample policy on data when sample_count < 10 without blocking deploy', () => {
    const state = readyState()
    state.apiTest.eventCount = 3
    state.apiTest.unionSchema = {
      total_events: 3,
      fields: [{ field_path: '$.id', field_type: 'string', occurrence_count: 3, sample_values: ['1'] }],
    }
    const snapshot = computeDeployReadiness(state, { ok: true, failed: false, unknown: false })
    const data = snapshot.categories.find((c) => c.key === 'data')
    expect(data?.tone).toBe('warn')
    expect(data?.detail).toContain('fewer than 10 events')
    expect(snapshot.canCreate).toBe(true)
    expect(snapshot.status).toBe('ready_with_warnings')
  })

  it('shows recommended sample warning on data when sample_count is 10–19', () => {
    const state = readyState()
    state.apiTest.eventCount = 15
    state.apiTest.unionSchema = {
      total_events: 15,
      fields: [{ field_path: '$.id', field_type: 'string', occurrence_count: 15, sample_values: ['1'] }],
    }
    const snapshot = computeDeployReadiness(state, { ok: true, failed: false, unknown: false })
    const data = snapshot.categories.find((c) => c.key === 'data')
    expect(data?.tone).toBe('warn')
    expect(data?.detail).toContain('fewer than 20 events')
    expect(snapshot.canCreate).toBe(true)
    expect(snapshot.status).toBe('ready_with_warnings')
  })
})
