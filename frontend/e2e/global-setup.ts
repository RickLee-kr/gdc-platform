const API_BASE = (process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')

export default async function globalSetup(): Promise<void> {
  const healthUrl = `${API_BASE}/health`
  let res: Response
  try {
    res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })
  } catch (err) {
    throw new Error(
      `Playwright E2E requires a running API at ${API_BASE} (GET /health failed: ${String(err)}). ` +
        'Start the backend with REQUIRE_AUTH=true before npm run test:e2e.',
    )
  }
  if (!res.ok) {
    throw new Error(`Playwright E2E backend health check failed: GET ${healthUrl} → ${res.status}`)
  }

  const statusUrl = `${API_BASE}/api/v1/runtime/status`
  const unauth = await fetch(statusUrl, { signal: AbortSignal.timeout(5_000) })
  if (unauth.status !== 401) {
    throw new Error(
      `Expected GET /api/v1/runtime/status to require auth (401), got ${unauth.status}. ` +
        'Ensure REQUIRE_AUTH=true for operator smoke E2E.',
    )
  }
}
