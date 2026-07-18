import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import {
  createScenarioApiContext,
  disposeScenarioApiContext,
  recreateScenarioApiContext,
  type ScenarioApiContext,
  waitForApiHealth,
} from './api-context'
import { DataRelayDriver } from './data-relay-driver'
import { EvidenceCollector } from './evidence-collector'
import { FixtureClient, loadLabEnv } from './fixture-client'
import {
  cleanupClientFromEnv,
  cleanupRegisteredResources,
  type CleanupReport,
} from './resource-cleanup'
import { ResourceRegistry } from './resource-registry'
import type { LabEnv, ScenarioId } from './scenario-types'

export type TestContext = {
  env: LabEnv
  fixtures: FixtureClient
  driver: DataRelayDriver
  evidence: EvidenceCollector
  runId: string
  registry: ResourceRegistry
  /** Owned scenario API context (null when using Playwright fixture request). */
  apiContext: ScenarioApiContext | null
}

export function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return process.env.GDC_E2E_RUN_ID || `run_${stamp}`
}

export async function createTestContext(opts: {
  request: APIRequestContext
  page?: Page | null
  testInfo: TestInfo
  scenarioId: ScenarioId
  runId?: string
  /** When true, create an owned APIRequestContext instead of reusing the Playwright fixture. */
  ownApiContext?: boolean
}): Promise<TestContext> {
  const env = loadLabEnv()
  let apiContext: ScenarioApiContext | null = null
  let request = opts.request
  if (opts.ownApiContext) {
    apiContext = await createScenarioApiContext({ baseURL: env.apiBaseUrl })
    request = apiContext.request
  }
  const fixtures = new FixtureClient(env, request)
  const runId = opts.runId || createRunId()
  const registry = new ResourceRegistry(runId, opts.scenarioId)
  const evidence = new EvidenceCollector(runId, opts.scenarioId)
  evidence.writeJsonFile('lab-env.json', {
    ...env,
    // mask already applied by writer for secret-like keys
  })
  evidence.writeText(
    'route-flag.txt',
    `GDC_ROUTE_PROCESSING_ENABLED=${env.routeProcessingEnabled}\nREQUIRE_AUTH=${env.requireAuth}\n`,
  )
  const driver = new DataRelayDriver(env, request, opts.page ?? null, fixtures)
  driver.bindRegistry(registry)
  await evidence.attachTraceHint(opts.testInfo)
  return { env, fixtures, driver, evidence, runId, registry, apiContext }
}

export async function recreateTestApiContext(ctx: TestContext): Promise<void> {
  ctx.driver.markDisposed()
  ctx.fixtures.markDisposed()
  await waitForApiHealth(ctx.env.apiBaseUrl)
  ctx.apiContext = await recreateScenarioApiContext(ctx.apiContext, { baseURL: ctx.env.apiBaseUrl })
  ctx.driver.bindRequest(ctx.apiContext.request)
  ctx.fixtures.bindRequest(ctx.apiContext.request)
  await ctx.driver.login()
}

/**
 * Evidence must already be collected. Then cleanup tracked IDs, then dispose HTTP context.
 * Cleanup failures are recorded but never change the scenario PASS/FAIL outcome.
 */
export async function finalizeTestContext(
  ctx: TestContext | null | undefined,
  opts?: { skipCleanup?: boolean; resetCollectors?: boolean },
): Promise<CleanupReport | null> {
  if (!ctx) return null
  let report: CleanupReport | null = null
  try {
    ctx.registry.flush()
    if (!opts?.skipCleanup && process.env.GDC_E2E_SKIP_CLEANUP !== '1') {
      const client = cleanupClientFromEnv(ctx.driver.request, ctx.driver.accessToken)
      const snapshot = ctx.registry.snapshot
      const scenarioId = ctx.registry.scenarioId
      // Prefer scenario-scoped IDs so earlier scenarios in the same run are not re-probed.
      if (scenarioId) {
        snapshot.resources = snapshot.resources.filter(
          (r) => !r.scenarioId || r.scenarioId === scenarioId,
        )
      }
      report = await cleanupRegisteredResources(client, ctx.runId, {
        resetCollectors: opts?.resetCollectors ?? false,
        registry: snapshot,
      })
      ctx.evidence.writeJsonFile('cleanup-report.json', report)
    }
  } catch (err) {
    ctx.evidence.writeJsonFile('cleanup-report.json', {
      ok: false,
      error: String(err),
      note: 'cleanup failed; scenario result unchanged',
    })
  }
  await disposeTestContext(ctx)
  return report
}

export async function disposeTestContext(ctx: TestContext | null | undefined): Promise<void> {
  if (!ctx) return
  try {
    ctx.registry.flush()
  } catch {
    /* ignore */
  }
  ctx.driver.markDisposed()
  ctx.fixtures.markDisposed()
  await disposeScenarioApiContext(ctx.apiContext)
  ctx.apiContext = null
}
