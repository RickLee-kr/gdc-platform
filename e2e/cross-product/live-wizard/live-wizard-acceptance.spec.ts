/**
 * P1 live Wizard acceptance for MIXED_TRANSFORM and MIXED_POLICY.
 *
 * Connector/destination records are lab fixtures (API). Stream create, Route Processing
 * overrides, and Deploy persist MUST go through Playwright Wizard UI.
 *
 * These tests must run whenever those topologies are Browser SUPPORTED.
 * They must not skip — a skip while the catalog says SUPPORTED is a FAIL.
 */
import { expect, test } from '@playwright/test'
import { wizardLiveCreateMixedRoutes, ORIGINAL_MESSAGE, ROUTE_B_TRANSFORM_SOURCE } from '../../framework/browser/wizard-live-acceptance.js'
import { createTestContext, finalizeTestContext } from '../../framework/test-context.js'
import { BROWSER_SUPPORTED_TOPOLOGIES } from '../applicability-rules.js'

const RUN_ID = process.env.GDC_E2E_RUN_ID || 'live-wizard-local'
const CORRELATION_ID = 'full-e2e-corr-noauth-1'

function payloadOf(msg: unknown): Record<string, unknown> {
  if (!msg || typeof msg !== 'object') return {}
  const body = (msg as { body?: unknown }).body
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  return msg as Record<string, unknown>
}

function mappingFields(mappingUi: unknown): Record<string, unknown> {
  if (!mappingUi || typeof mappingUi !== 'object') return {}
  const row = mappingUi as {
    inherit?: boolean
    inherit_stream_mapping?: boolean
    mapping?: { field_mappings?: Record<string, unknown> }
    field_mappings?: Record<string, unknown>
  }
  return row.mapping?.field_mappings || row.field_mappings || {}
}

function mappingInherits(mappingUi: unknown): boolean {
  if (!mappingUi || typeof mappingUi !== 'object') return false
  const row = mappingUi as { inherit?: boolean; inherit_stream_mapping?: boolean }
  return row.inherit === true || row.inherit_stream_mapping === true
}

function runtimeRouteCounts(
  status: unknown,
): Array<{ route_id?: number; counts?: Record<string, number> }> {
  if (!status || typeof status !== 'object') return []
  const root = status as Record<string, unknown>
  const inner =
    root.body && typeof root.body === 'object' ? (root.body as Record<string, unknown>) : root
  const stats = inner.stats
  if (!stats || typeof stats !== 'object') return []
  const routes = (stats as { routes?: unknown }).routes
  return Array.isArray(routes) ? (routes as Array<{ route_id?: number; counts?: Record<string, number> }>) : []
}

test.describe('P1 live Wizard acceptance', () => {
  test('MIXED_TRANSFORM Wizard → persist route_transform → Route B only transformed', async ({
    request,
    page,
  }, testInfo) => {
    testInfo.setTimeout(240_000)
    expect(
      BROWSER_SUPPORTED_TOPOLOGIES.has('MULTI_ROUTE_MIXED_TRANSFORM_OVERRIDE'),
      'MIXED_TRANSFORM must stay Browser SUPPORTED for this live Wizard test to be in the execution set',
    ).toBe(true)

    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'live-wizard-mixed-transform',
      runId: RUN_ID,
      ownApiContext: true,
    })
    const { driver, fixtures, evidence, env, registry } = ctx
    let streamId: number | null = null

    try {
      await driver.login()
      await driver.assertRouteFlagOrFail()
      if (!env.routeProcessingEnabled) {
        throw new Error(
          'MIXED_TRANSFORM live Wizard requires GDC_ROUTE_PROCESSING_ENABLED=true; skip is not allowed while topology is Browser SUPPORTED',
        )
      }

      const suffix = Date.now().toString(36)
      const connectorName = `${env.namePrefix} lw-tf-conn ${suffix}`
      const destAName = `${env.namePrefix} lw-tf-a ${suffix}`
      const destBName = `${env.namePrefix} lw-tf-b ${suffix}`
      const streamName = `${env.namePrefix} lw-tf-stream ${suffix}`

      const connector = await driver.createHttpConnector({
        name: connectorName,
        auth: 'no_auth',
        path: '/no-auth/events',
      })
      const destA = await driver.createWebhookDestination(destAName, { collectPath: `/collect-lw-tf-a-${suffix}` })
      const destB = await driver.createWebhookDestination(destBName, { collectPath: `/collect-lw-tf-b-${suffix}` })
      evidence.writeJsonFile('lab-fixtures.json', { connector, destA, destB, seed: 'connector_destination_only' })

      streamId = await wizardLiveCreateMixedRoutes(page, env.uiBaseUrl, {
        connectorId: connector.connectorId,
        connectorName,
        streamName,
        endpoint: connector.endpointPath,
        destAName,
        destBName,
        mode: 'transform',
        lookupStreamId: () => driver.findStreamIdByName(streamName),
      })
      evidence.writeJsonFile('wizard-deploy.json', { streamId, persistKind: 'route_transform', apiSeedStream: false })

      const routes = await driver.listRoutesForStream(streamId)
      registry.trackStream({ streamId, name: streamName, routeIds: routes.map((r) => r.id) })
      expect(routes.length, 'wizard must persist two routes').toBe(2)

      const routeA = routes.find((r) => r.destination_id === destA.destinationId)
      const routeB = routes.find((r) => r.destination_id === destB.destinationId)
      expect(routeA, 'Route A destination persist').toBeTruthy()
      expect(routeB, 'Route B destination persist').toBeTruthy()

      const mapA = await driver.getRouteMappingUi(routeA!.id)
      const mapB = await driver.getRouteMappingUi(routeB!.id)
      evidence.writeJsonFile('route-mapping-ui.json', { routeA: mapA, routeB: mapB })
      expect(mappingInherits(mapA), 'Route A must inherit transform').toBe(true)
      expect(mappingInherits(mapB), 'Route B must persist transform override (not inherit)').toBe(false)
      const fieldsB = mappingFields(mapB)
      expect(String(fieldsB.message || ''), 'Route B message mapping').toBe(ROUTE_B_TRANSFORM_SOURCE)

      await fixtures.resetCollectors()
      await driver.runStream(streamId)
      await driver.waitForStreamProcessing(streamId, 20_000).catch(() => undefined)
      await driver.waitForDelivery({
        kind: 'webhook',
        correlationId: CORRELATION_ID,
        timeoutMs: 45_000,
      })
      const deadline = Date.now() + 20_000
      let received: unknown[] = []
      let msgsA: Record<string, unknown>[] = []
      let msgsB: Record<string, unknown>[] = []
      while (Date.now() < deadline) {
        received = await fixtures.listWebhookMessages(200)
        msgsA = received
          .filter((m) => String((m as { path?: string }).path || '').includes(destA.collectPath))
          .map(payloadOf)
        msgsB = received
          .filter((m) => String((m as { path?: string }).path || '').includes(destB.collectPath))
          .map(payloadOf)
        if (msgsA.length > 0 && msgsB.length > 0) break
        await new Promise((r) => setTimeout(r, 500))
      }
      evidence.writeJsonFile('collector-messages.json', received)
      expect(msgsA.length, 'Route A collector delivery').toBeGreaterThan(0)
      expect(msgsB.length, 'Route B collector delivery').toBeGreaterThan(0)
      expect(
        msgsA.some((p) => String(p.message) === ORIGINAL_MESSAGE),
        'Route A keeps original message field',
      ).toBe(true)
      expect(
        msgsA.every((p) => String(p.message) !== 'full-e2e-noauth-1'),
        'Route A must not receive Route B transform',
      ).toBe(true)
      expect(
        msgsB.some((p) => String(p.message) === 'full-e2e-noauth-1'),
        'Route B applies transform (message sourced from $.id)',
      ).toBe(true)
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })

  test('MIXED_POLICY Wizard → persist governance → Route B block isolation', async ({
    request,
    page,
  }, testInfo) => {
    testInfo.setTimeout(240_000)
    expect(
      BROWSER_SUPPORTED_TOPOLOGIES.has('MULTI_ROUTE_MIXED_POLICY_OVERRIDE'),
      'MIXED_POLICY must stay Browser SUPPORTED for this live Wizard test to be in the execution set',
    ).toBe(true)

    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'live-wizard-mixed-policy',
      runId: RUN_ID,
      ownApiContext: true,
    })
    const { driver, fixtures, evidence, env, registry } = ctx
    let streamId: number | null = null

    try {
      await driver.login()
      await driver.assertRouteFlagOrFail()
      if (!env.routeProcessingEnabled) {
        throw new Error(
          'MIXED_POLICY live Wizard requires GDC_ROUTE_PROCESSING_ENABLED=true; skip is not allowed while topology is Browser SUPPORTED',
        )
      }

      const suffix = Date.now().toString(36)
      const connectorName = `${env.namePrefix} lw-pol-conn ${suffix}`
      const destAName = `${env.namePrefix} lw-pol-a ${suffix}`
      const destBName = `${env.namePrefix} lw-pol-b ${suffix}`
      const streamName = `${env.namePrefix} lw-pol-stream ${suffix}`

      const connector = await driver.createHttpConnector({
        name: connectorName,
        auth: 'no_auth',
        path: '/no-auth/events',
      })
      const destA = await driver.createWebhookDestination(destAName, { collectPath: `/collect-lw-pol-a-${suffix}` })
      const destB = await driver.createWebhookDestination(destBName, { collectPath: `/collect-lw-pol-b-${suffix}` })
      evidence.writeJsonFile('lab-fixtures.json', { connector, destA, destB, seed: 'connector_destination_only' })

      streamId = await wizardLiveCreateMixedRoutes(page, env.uiBaseUrl, {
        connectorId: connector.connectorId,
        connectorName,
        streamName,
        endpoint: connector.endpointPath,
        destAName,
        destBName,
        mode: 'policy',
        lookupStreamId: () => driver.findStreamIdByName(streamName),
      })
      evidence.writeJsonFile('wizard-deploy.json', { streamId, persistKind: 'governance', apiSeedStream: false })

      const routes = await driver.listRoutesForStream(streamId)
      registry.trackStream({ streamId, name: streamName, routeIds: routes.map((r) => r.id) })
      expect(routes.length, 'wizard must persist two routes').toBe(2)
      const routeA = routes.find((r) => r.destination_id === destA.destinationId)
      const routeB = routes.find((r) => r.destination_id === destB.destinationId)
      expect(routeA).toBeTruthy()
      expect(routeB).toBeTruthy()

      const gov = await driver.getStreamGovernance(streamId)
      const policyB = await driver.getRoutePolicyRules(routeB!.id)
      evidence.writeJsonFile('governance-persist.json', { gov, policyB })
      const overrides =
        gov && typeof gov === 'object' && Array.isArray((gov as { route_overrides?: unknown[] }).route_overrides)
          ? ((gov as { route_overrides: Array<{ route_id?: number; delivery_behavior?: string }> }).route_overrides)
          : []
      const routeBOverride = overrides.find((row) => Number(row.route_id) === routeB!.id)
      expect(routeBOverride, 'persisted governance must include Route B override').toBeTruthy()
      expect(routeBOverride?.delivery_behavior, 'Route B persistKind=governance delivery_behavior').toBe('block')
      expect(
        overrides.some((row) => Number(row.route_id) === routeA!.id && row.delivery_behavior === 'block'),
        'Route A must not persist a block override',
      ).toBe(false)

      await fixtures.resetCollectors()
      await driver.runStream(streamId)
      await driver.waitForStreamProcessing(streamId, 20_000).catch(() => undefined)
      await driver.waitForDeliveryLog(streamId, { timeoutMs: 20_000 }).catch(() => undefined)

      const received = await driver.waitForDelivery({
        kind: 'webhook',
        correlationId: CORRELATION_ID,
        timeoutMs: 45_000,
      })
      await new Promise((r) => setTimeout(r, 3_000))
      const all = await fixtures.listWebhookMessages(200)
      evidence.writeJsonFile('collector-messages.json', { first: received, all })
      const msgsA = all.filter((m) => String((m as { path?: string }).path || '').includes(destA.collectPath))
      const msgsB = all.filter((m) => String((m as { path?: string }).path || '').includes(destB.collectPath))
      expect(msgsA.length, 'Route A delivered').toBeGreaterThan(0)
      expect(msgsB.length, 'Route B blocked — no collector delivery').toBe(0)

      const logs = await driver.getDeliveryLogs(streamId)
      const status = await driver.getRuntimeStatus(streamId)
      evidence.writeJsonFile('delivery-logs.json', logs)
      evidence.writeJsonFile('runtime-status-assert.json', status)
      const routeRows = runtimeRouteCounts(status)
      const countsA = routeRows.find((row) => Number(row.route_id) === routeA!.id)?.counts || {}
      const countsB = routeRows.find((row) => Number(row.route_id) === routeB!.id)?.counts || {}
      expect(Number(countsA.route_send_success || 0), 'Route A runtime send success').toBeGreaterThan(0)
      expect(Number(countsB.route_send_success || 0), 'Route B must not send (policy block)').toBe(0)
      expect(Number(countsB.route_send_failed || 0), 'Route B must not look like destination failure').toBe(0)
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })
})
