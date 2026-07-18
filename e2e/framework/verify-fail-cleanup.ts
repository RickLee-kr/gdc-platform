/**
 * One-shot verification: intentional FAIL still collects evidence then cleans IDs.
 * Not part of CI matrix — invoked manually during cleanup rollout validation.
 */
import { request as playwrightRequest } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestContext, finalizeTestContext } from './test-context'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reportsRoot = path.join(__dirname, '..', 'reports')

async function main(): Promise<void> {
  const runId = process.env.GDC_E2E_RUN_ID || `cleanup-verify-fail-${Date.now()}`
  const api = await playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:18000',
  })
  const fakeTestInfo = {
    attach: async () => {},
    outputPath: (...parts: string[]) => path.join(reportsRoot, runId, ...parts),
  } as never

  const ctx = await createTestContext({
    request: api,
    page: null,
    testInfo: fakeTestInfo,
    scenarioId: 'intentional-fail-cleanup',
    runId,
    ownApiContext: true,
  })

  let failed = false
  let streamId: number | null = null
  try {
    await ctx.fixtures.resetCollectors()
    await ctx.driver.login()
    const suffix = Date.now().toString(36)
    const connector = await ctx.driver.createHttpConnector({
      name: `${ctx.env.namePrefix} fail-path ${suffix}`,
      auth: 'no_auth',
      path: '/no-auth/events',
    })
    const dest = await ctx.driver.createWebhookDestination(`${ctx.env.namePrefix} fail-dest ${suffix}`)
    const stream = await ctx.driver.createStream({
      name: `${ctx.env.namePrefix} fail-stream ${suffix}`,
      connectorId: connector.connectorId,
      sourceId: connector.sourceId,
      destinationId: dest.destinationId,
      endpointPath: connector.endpointPath,
    })
    streamId = stream.streamId
    const mid = await ctx.driver.request.get(`${ctx.env.apiBaseUrl}/api/v1/streams/${streamId}`)
    if (!mid.ok()) throw new Error('stream missing before fail')
    ctx.evidence.writeJsonFile('mid-run-stream.json', await mid.json())
    throw new Error('INTENTIONAL_FAIL_FOR_CLEANUP_PATH')
  } catch (err) {
    failed = String(err).includes('INTENTIONAL_FAIL_FOR_CLEANUP_PATH')
    await ctx.evidence
      .collectApiBundle(ctx.driver.request, ctx.env.apiBaseUrl, streamId, { accessToken: ctx.driver.accessToken })
      .catch(() => null)
    ctx.evidence.writeJsonFile('result.json', { status: 'FAIL', error: String(err) })
  } finally {
    await ctx.evidence
      .collectApiBundle(ctx.driver.request, ctx.env.apiBaseUrl, streamId, { accessToken: ctx.driver.accessToken })
      .catch(() => null)
    const report = await finalizeTestContext(ctx)
    const evidenceDir = path.join(reportsRoot, runId, 'intentional-fail-cleanup')
    const hasEvidence =
      fs.existsSync(path.join(evidenceDir, 'result.json')) &&
      fs.existsSync(path.join(evidenceDir, 'cleanup-report.json')) &&
      fs.existsSync(path.join(evidenceDir, 'mid-run-stream.json'))
    const registry = JSON.parse(fs.readFileSync(path.join(reportsRoot, runId, 'created-resources.json'), 'utf8')) as {
      resources: Array<{ kind: string; id: number }>
    }
    const ids = {
      streams: registry.resources.filter((r) => r.kind === 'stream').map((r) => r.id),
      connectors: registry.resources.filter((r) => r.kind === 'connector').map((r) => r.id),
      destinations: registry.resources.filter((r) => r.kind === 'destination').map((r) => r.id),
    }
    const remaining = { streams: [] as number[], connectors: [] as number[], destinations: [] as number[] }
    for (const id of ids.streams) {
      if ((await api.get(`/api/v1/streams/${id}`)).ok()) remaining.streams.push(id)
    }
    for (const id of ids.connectors) {
      if ((await api.get(`/api/v1/connectors/${id}`)).ok()) remaining.connectors.push(id)
    }
    for (const id of ids.destinations) {
      if ((await api.get(`/api/v1/destinations/${id}`)).ok()) remaining.destinations.push(id)
    }
    const out = { runId, failed, hasEvidence, cleanupOk: report?.ok ?? false, remaining, evidenceDir }
    console.log(JSON.stringify(out, null, 2))
    if (
      !failed ||
      !hasEvidence ||
      !report?.ok ||
      remaining.streams.length ||
      remaining.connectors.length ||
      remaining.destinations.length
    ) {
      process.exitCode = 1
    }
    await api.dispose()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
