/**
 * CLI for Full E2E resource cleanup.
 *
 *   npx tsx framework/cleanup-cli.ts cleanup --run-id <id>
 *   npx tsx framework/cleanup-cli.ts cleanup-stale
 *   npx tsx framework/cleanup-cli.ts validate-cleanup --run-id <id>
 *   npx tsx framework/cleanup-cli.ts inventory-owned --write-run-id <id>
 */
import { request as playwrightRequest } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanupRegisteredResources,
  cleanupStaleOwnedRuns,
  validateCleanup,
  type CleanupClient,
} from './resource-cleanup'
import { loadLabEnv } from './fixture-client'

function argValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  if (i >= 0) return argv[i + 1]
  return undefined
}

async function buildClient(): Promise<{ client: CleanupClient; dispose: () => Promise<void> }> {
  const env = loadLabEnv()
  const ctx = await playwrightRequest.newContext({ baseURL: env.apiBaseUrl })
  let accessToken: string | null = null
  if (env.requireAuth) {
    const res = await ctx.post('/api/v1/auth/login', { data: { username: 'admin', password: 'admin' } })
    if (res.ok()) {
      const body = (await res.json()) as { access_token?: string }
      accessToken = body.access_token ?? null
    }
  }
  return {
    client: {
      apiBaseUrl: env.apiBaseUrl,
      request: ctx,
      accessToken,
      webhookCollectorUrl: env.webhookCollectorUrl,
      syslogCollectorApiUrl: env.syslogCollectorApiUrl,
    },
    dispose: async () => ctx.dispose(),
  }
}

async function inventoryOwnedFromDb(writeRunId: string): Promise<void> {
  const { spawnSync } = await import('node:child_process')
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inventory_owned_resources.py')
  const envFile = process.env.GDC_E2E_ENV_FILE
  const env = { ...process.env, GDC_E2E_INVENTORY_RUN_ID: writeRunId }
  if (envFile && fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      env[m[1]] = v
    }
  }
  const proc = spawnSync('python3', [script], { encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024 })
  if (proc.status !== 0) {
    throw new Error(`inventory python failed: ${proc.stderr || proc.stdout}`)
  }
  console.log(proc.stdout.trim())
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd) {
    console.error(
      'Usage: cleanup|cleanup-stale|validate-cleanup|inventory-owned [--run-id <id>] [--write-run-id <id>]',
    )
    process.exit(2)
  }

  if (cmd === 'inventory-owned') {
    const writeRunId = argValue(argv, '--write-run-id') || argValue(argv, '--run-id') || `stale-owned-${Date.now()}`
    await inventoryOwnedFromDb(writeRunId)
    return
  }

  const { client, dispose } = await buildClient()
  try {
    if (cmd === 'cleanup') {
      const runId = argValue(argv, '--run-id') || process.env.GDC_E2E_RUN_ID
      if (!runId) throw new Error('--run-id required')
      const report = await cleanupRegisteredResources(client, runId, { resetCollectors: true })
      console.log(JSON.stringify({ ok: report.ok, remaining: report.remaining, errors: report.errors }, null, 2))
      process.exitCode = report.ok ? 0 : 1
      return
    }
    if (cmd === 'validate-cleanup') {
      const runId = argValue(argv, '--run-id') || process.env.GDC_E2E_RUN_ID
      if (!runId) throw new Error('--run-id required')
      const report = await validateCleanup(client, runId)
      console.log(JSON.stringify({ ok: report.ok, remaining: report.remaining, errors: report.errors }, null, 2))
      process.exitCode = report.ok ? 0 : 1
      return
    }
    if (cmd === 'cleanup-stale') {
      // Only registry-backed ownership. Optionally invent inventory first via inventory-owned.
      const results = await cleanupStaleOwnedRuns(client, { resetCollectors: true })
      const failed = results.filter((r) => !r.report.ok)
      console.log(
        JSON.stringify(
          {
            runs: results.length,
            failed: failed.length,
            details: results.map((r) => ({
              runId: r.runId,
              ok: r.report.ok,
              remaining: r.report.remaining,
              errors: r.report.errors,
            })),
          },
          null,
          2,
        ),
      )
      process.exitCode = failed.length ? 1 : 0
      return
    }
    console.error(`Unknown command: ${cmd}`)
    process.exitCode = 2
  } finally {
    await dispose()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
