/**
 * Scenario-scoped Playwright APIRequestContext lifecycle helpers.
 *
 * Do not dispose Playwright's shared test fixture `request`.
 * Scenario helpers create/dispose only contexts they own.
 */
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'

export type ScenarioApiContext = {
  request: APIRequestContext
  owned: boolean
}

export async function createScenarioApiContext(opts?: {
  baseURL?: string
}): Promise<ScenarioApiContext> {
  const ctx = await playwrightRequest.newContext({
    baseURL: opts?.baseURL,
    ignoreHTTPSErrors: true,
  })
  return { request: ctx, owned: true }
}

export async function disposeScenarioApiContext(ctx: ScenarioApiContext | null | undefined): Promise<void> {
  if (!ctx?.owned || !ctx.request) return
  try {
    await ctx.request.dispose()
  } catch {
    /* already disposed */
  }
}

export async function recreateScenarioApiContext(
  previous: ScenarioApiContext | null | undefined,
  opts?: { baseURL?: string },
): Promise<ScenarioApiContext> {
  await disposeScenarioApiContext(previous)
  return createScenarioApiContext(opts)
}

/** Patterns that indicate a dead/disposed request context (infra-only). */
export function isDisposedRequestContextError(err: unknown): boolean {
  const msg = String(err)
  return (
    /request context disposed/i.test(msg) ||
    /Target page, context or browser has been closed/i.test(msg) ||
    (/apiRequestContext\.(get|post|put|delete|patch|fetch)/i.test(msg) && /disposed|closed/i.test(msg))
  )
}

export async function waitForApiHealth(apiBaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const healthUrl = `${apiBaseUrl.replace(/\/$/, '')}/health`
  // Use a short-lived context so health checks never reuse a disposed scenario context.
  while (Date.now() < deadline) {
    const probe = await createScenarioApiContext()
    try {
      const res = await probe.request.get(healthUrl)
      if (res.ok()) return
    } catch {
      /* retry */
    } finally {
      await disposeScenarioApiContext(probe)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw Object.assign(new Error(`API health recovery timeout after ${timeoutMs}ms (${healthUrl})`), {
    classification: 'TEST_INFRA',
  })
}
