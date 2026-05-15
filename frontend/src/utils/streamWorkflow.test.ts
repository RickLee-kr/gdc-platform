import { describe, expect, it } from 'vitest'
import { computeStreamWorkflow, resolveStreamRouteIdentifier } from './streamWorkflow'

const baseInput = {
  streamId: '12',
  status: 'RUNNING' as const,
  events1h: 1500,
  deliveryPct: 99.5,
  routesTotal: 2,
  routesOk: 2,
  routesDegraded: 0,
  routesError: 0,
}

describe('computeStreamWorkflow', () => {
  it('marks every step complete when stream is healthy', () => {
    const wf = computeStreamWorkflow(baseInput)
    expect(wf.completedCount).toBe(wf.totalCount)
    expect(wf.pct).toBe(100)
    expect(wf.isReadyToStart).toBe(true)
    expect(wf.isRunning).toBe(true)
    expect(wf.nextStepKey).toBeNull()
    expect(wf.nextStepLabel).toBe('View Runtime')
    expect(wf.nextStepPath).toContain('/streams/12/runtime')
    expect(wf.isNumericStreamId).toBe(true)
  })

  it('flags missing API test, mapping, route signals when stream is fresh', () => {
    const wf = computeStreamWorkflow({
      streamId: 'malop-api',
      status: 'STOPPED',
      events1h: 0,
      deliveryPct: 0,
      routesTotal: 0,
      routesOk: 0,
    })

    const byKey = Object.fromEntries(wf.steps.map((s) => [s.key, s]))
    expect(byKey.connector.status).toBe('complete')
    expect(byKey.apiTest.status).toBe('pending')
    expect(byKey.mapping.status).toBe('pending')
    expect(byKey.enrichment.status).toBe('pending')
    expect(byKey.destination.status).toBe('pending')
    expect(byKey.route.status).toBe('pending')
    expect(byKey.saved.status).toBe('complete')
    expect(wf.isReadyToStart).toBe(false)
    expect(wf.isRunning).toBe(false)
    expect(wf.nextStepKey).toBe('apiTest')
    expect(wf.nextStepLabel).toBe('Run API Test')
    expect(wf.nextStepPath).toContain('/streams/malop-api/api-test')
    expect(wf.isNumericStreamId).toBe(false)
  })

  it('uses remote-file workflow labels when sourceType is REMOTE_FILE_POLLING', () => {
    const wf = computeStreamWorkflow({
      streamId: 'malop-api',
      status: 'STOPPED',
      events1h: 0,
      deliveryPct: 0,
      routesTotal: 0,
      routesOk: 0,
      sourceType: 'REMOTE_FILE_POLLING',
    })
    const byKey = Object.fromEntries(wf.steps.map((s) => [s.key, s]))
    expect(byKey.apiTest.shortLabel).toBe('Remote probe')
    expect(wf.nextStepLabel).toBe('Run remote probe')
  })

  it('treats route as configured when mapping-ui reports enabled route even if health counts zero healthy', () => {
    const wf = computeStreamWorkflow({
      streamId: '12',
      status: 'RUNNING' as const,
      events1h: 0,
      deliveryPct: 0,
      routesTotal: 1,
      routesOk: 0,
      routesError: 0,
      persistedRoutesCount: 1,
      enabledDeliveryRoute: true,
      mappingPersisted: true,
      enrichmentPersisted: true,
      apiTestDone: true,
      hasSaved: true,
    })
    const route = wf.steps.find((s) => s.key === 'route')!
    expect(route.status).toBe('complete')
    expect(wf.nextStepLabel).toBe('View Runtime')
  })

  it('marks route as attention when destination exists but no route is healthy', () => {
    const wf = computeStreamWorkflow({
      ...baseInput,
      routesOk: 0,
      routesDegraded: 0,
      routesError: 1,
    })
    const route = wf.steps.find((s) => s.key === 'route')!
    expect(route.status).toBe('attention')
    expect(wf.attentionCount).toBeGreaterThanOrEqual(1)
    expect(wf.nextStepKey).toBe('route')
    expect(wf.nextStepLabel).toBe('Enable Route')
    expect(wf.nextStepPath).toMatch(/\/streams\/12\/edit(?:\?|$)/)
    expect(wf.nextStepPath).not.toContain('section=delivery')
  })

  it('marks Start Stream as next action when configured but stopped', () => {
    const wf = computeStreamWorkflow({
      ...baseInput,
      status: 'STOPPED',
    })
    expect(wf.isReadyToStart).toBe(true)
    expect(wf.nextStepKey).toBeNull()
    expect(wf.nextStepLabel).toBe('Start Stream')
    expect(wf.nextStepPath).toContain('/streams/12/runtime')
  })

  it('respects manual override flags from wizard state', () => {
    const wf = computeStreamWorkflow({
      ...baseInput,
      events1h: 0,
      deliveryPct: 0,
      routesTotal: 0,
      routesOk: 0,
      hasApiTest: true,
      hasMapping: true,
      hasEnrichment: true,
    })
    const byKey = Object.fromEntries(wf.steps.map((s) => [s.key, s]))
    expect(byKey.apiTest.status).toBe('complete')
    expect(byKey.mapping.status).toBe('complete')
    expect(byKey.enrichment.status).toBe('complete')
    expect(byKey.destination.status).toBe('pending')
    expect(byKey.route.status).toBe('pending')
  })

  it('downgrades configured steps to attention when runtime is in ERROR', () => {
    const wf = computeStreamWorkflow({
      ...baseInput,
      status: 'ERROR',
    })
    const route = wf.steps.find((s) => s.key === 'route')!
    expect(route.status).toBe('attention')
    expect(wf.attentionCount).toBeGreaterThan(0)
  })
})

describe('resolveStreamRouteIdentifier', () => {
  it('keeps numeric ids as backend ids', () => {
    const result = resolveStreamRouteIdentifier('42')
    expect(result.id).toBe(42)
    expect(result.slug).toBe('42')
  })

  it('maps known runtime stream names to canonical slugs', () => {
    expect(resolveStreamRouteIdentifier('Malop API Stream').slug).toBe('malop-api')
    expect(resolveStreamRouteIdentifier('Hunting API Stream').slug).toBe('hunting-api')
    expect(resolveStreamRouteIdentifier('Sensor inventory').slug).toBe('sensor-inventory')
    expect(resolveStreamRouteIdentifier('Detections stream').slug).toBe('crowdstrike-detections')
  })

  it('falls back to deterministic slug when no mapping exists', () => {
    const result = resolveStreamRouteIdentifier('Custom Vendor Stream')
    expect(result.id).toBeNull()
    expect(result.slug).toBe('custom-vendor-stream')
  })

  it('returns empty slug for empty name', () => {
    const result = resolveStreamRouteIdentifier('')
    expect(result.slug).toBe('')
    expect(result.id).toBeNull()
  })
})
