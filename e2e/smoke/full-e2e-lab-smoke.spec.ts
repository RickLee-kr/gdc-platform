import { test, expect } from '@playwright/test'
import { assertCorrelationDelivered, assertExpectedMatchesDeliveryAndCollector } from '../framework/assertions'
import { createTestContext, finalizeTestContext } from '../framework/test-context'

const RUN_ID = process.env.GDC_E2E_RUN_ID

test.describe('Full E2E Lab smoke', () => {
  test('HTTP No Auth → Webhook delivery', async ({ request, page }, testInfo) => {
    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'http-no-auth-webhook',
      runId: RUN_ID,
    })
    const { driver, fixtures, evidence, env } = ctx
    const correlationId = 'full-e2e-corr-noauth-1'
    let streamId: number | null = null

    try {
      await fixtures.resetCollectors()
      await driver.login()
      await driver.assertRouteFlagOrFail()

      const suffix = Date.now().toString(36)
      const connector = await driver.createHttpConnector({
        name: `${env.namePrefix} HTTP no-auth ${suffix}`,
        auth: 'no_auth',
        path: '/no-auth/events',
      })
      await driver.testConnector(connector.connectorId)
      await driver.runSample(connector.connectorId)

      const dest = await driver.createWebhookDestination(`${env.namePrefix} WH ${suffix}`)
      await driver.testDestination(dest.destinationId)

      const stream = await driver.createStream({
        name: `${env.namePrefix} HTTP→WH ${suffix}`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinationId: dest.destinationId,
        endpointPath: connector.endpointPath,
      })
      streamId = stream.streamId
      ctx.registry.trackCorrelation(correlationId)
      await driver.selectRecordPath(stream.streamId, '$.data')
      await driver.configureCheckpoint(stream.streamId)
      await driver.deployStream(stream.streamId)

      const run = await driver.runStream(stream.streamId)
      evidence.writeJsonFile('run-once.json', run)

      const received = await driver.waitForDelivery({ kind: 'webhook', correlationId, timeoutMs: 45_000 })
      assertCorrelationDelivered(received, correlationId)
      evidence.writeJsonFile('expected-payload.json', { e2e_correlation_id: correlationId })
      evidence.writeJsonFile('received-payload.json', received)

      const logs = await driver.getDeliveryLogs(stream.streamId)
      evidence.writeJsonFile('delivery-logs.json', logs)
      assertExpectedMatchesDeliveryAndCollector(
        { e2e_correlation_id: correlationId },
        logs,
        received,
      )

      await evidence.captureScreenshot(page)
      evidence.recordUiUrl(env.uiBaseUrl)
      expect(received.length).toBeGreaterThan(0)
    } catch (err) {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await evidence.captureScreenshot(page)
      throw err
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })

  test('HTTP Basic → Webhook delivery + auth header journal', async ({ request, page }, testInfo) => {
    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'http-basic-webhook',
      runId: RUN_ID,
    })
    const { driver, fixtures, evidence, env } = ctx
    const correlationId = 'full-e2e-corr-basic-1'
    let streamId: number | null = null

    try {
      await fixtures.resetCollectors()
      await driver.login()
      await driver.assertRouteFlagOrFail()

      // Confirm WireMock rejects missing basic auth
      const unauth = await fixtures.probeHttpAuth('/basic/events')
      expect(unauth.status).toBe(401)

      const suffix = Date.now().toString(36)
      const connector = await driver.createHttpConnector({
        name: `${env.namePrefix} HTTP basic ${suffix}`,
        auth: 'basic',
        path: '/basic/events',
      })
      const dest = await driver.createWebhookDestination(`${env.namePrefix} WH basic ${suffix}`)
      const stream = await driver.createStream({
        name: `${env.namePrefix} Basic→WH ${suffix}`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinationId: dest.destinationId,
        endpointPath: connector.endpointPath,
      })
      streamId = stream.streamId
      ctx.registry.trackCorrelation(correlationId)
      await driver.deployStream(stream.streamId)
      await driver.runStream(stream.streamId)

      const received = await driver.waitForDelivery({ kind: 'webhook', correlationId, timeoutMs: 45_000 })
      assertCorrelationDelivered(received, correlationId)
      evidence.writeJsonFile('received-payload.json', received)

      // Auth header evidence via WireMock journal
      const journal = await request.get(`${env.wiremockBaseUrl}/__admin/requests`)
      const journalBody = await journal.json()
      evidence.writeJsonFile('wiremock-journal.json', journalBody)
      const reqs = (journalBody as { requests?: Array<{ request?: { url?: string; headers?: Record<string, unknown> } }> })
        .requests ?? []
      const basicHit = reqs.find((r) => String(r.request?.url || '').includes('/basic/events'))
      expect(basicHit, 'expected WireMock journal entry for /basic/events').toBeTruthy()
      const authHeader = basicHit?.request?.headers?.Authorization || basicHit?.request?.headers?.authorization
      expect(authHeader, 'Authorization header should be present on basic fetch').toBeTruthy()
    } catch (err) {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      throw err
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })

  test('PostgreSQL → Webhook delivery', async ({ request, page }, testInfo) => {
    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'postgres-webhook',
      runId: RUN_ID,
    })
    const { driver, fixtures, evidence, env } = ctx
    const correlationId = 'full-e2e-corr-db-1'
    let streamId: number | null = null

    try {
      await fixtures.resetCollectors()
      await driver.login()
      await driver.assertRouteFlagOrFail()

      const suffix = Date.now().toString(36)
      const connector = await driver.createPostgresConnector(`${env.namePrefix} PG ${suffix}`)
      await driver.testConnector(connector.connectorId)
      const dest = await driver.createWebhookDestination(`${env.namePrefix} WH pg ${suffix}`)
      const stream = await driver.createStream({
        name: `${env.namePrefix} PG→WH ${suffix}`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinationId: dest.destinationId,
        sqlMode: true,
      })
      streamId = stream.streamId
      ctx.registry.trackCorrelation(correlationId)
      await driver.deployStream(stream.streamId)
      await driver.runStream(stream.streamId)

      const received = await driver.waitForDelivery({ kind: 'webhook', correlationId, timeoutMs: 60_000 })
      assertCorrelationDelivered(received, correlationId)
      evidence.writeJsonFile('received-payload.json', received)
    } catch (err) {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      throw err
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })

  test('HTTP No Auth → Syslog TCP delivery', async ({ request, page }, testInfo) => {
    const ctx = await createTestContext({
      request,
      page,
      testInfo,
      scenarioId: 'http-no-auth-syslog-tcp',
      runId: RUN_ID,
    })
    const { driver, fixtures, evidence, env } = ctx
    const correlationId = 'full-e2e-corr-noauth-1'
    let streamId: number | null = null

    try {
      await fixtures.resetCollectors()
      await driver.login()
      await driver.assertRouteFlagOrFail()

      const suffix = Date.now().toString(36)
      const connector = await driver.createHttpConnector({
        name: `${env.namePrefix} HTTP syslog ${suffix}`,
        auth: 'no_auth',
        path: '/no-auth/events',
      })
      const dest = await driver.createSyslogTcpDestination(`${env.namePrefix} SYSLOG TCP ${suffix}`)
      await driver.testDestination(dest.destinationId)
      const stream = await driver.createStream({
        name: `${env.namePrefix} HTTP→SYSLOG ${suffix}`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinationId: dest.destinationId,
        endpointPath: connector.endpointPath,
      })
      streamId = stream.streamId
      ctx.registry.trackCorrelation(correlationId)
      await driver.deployStream(stream.streamId)
      await driver.runStream(stream.streamId)

      const received = await driver.waitForDelivery({
        kind: 'syslog',
        correlationId,
        protocol: 'TCP',
        timeoutMs: 45_000,
      })
      assertCorrelationDelivered(received, correlationId)
      evidence.writeJsonFile('received-payload.json', received)
      expect(received.length).toBeGreaterThan(0)
    } catch (err) {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      throw err
    } finally {
      await evidence.collectApiBundle(request, env.apiBaseUrl, streamId)
      await finalizeTestContext(ctx)
    }
  })
})
