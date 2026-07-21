#!/usr/bin/env npx tsx
import { request as pwRequest } from '@playwright/test'
import { FixtureClient, loadLabEnv } from '../framework/fixture-client.js'

async function main() {
  const env = loadLabEnv()
  const ctx = await pwRequest.newContext()
  const fixtures = new FixtureClient(env, ctx)
  const t0 = Date.now()
  await fixtures.ensureSyslogTlsReady(20_000)
  console.log(
    JSON.stringify({
      ok: true,
      ms: Date.now() - t0,
      port: env.syslogTlsPort,
      api: env.syslogCollectorApiUrl,
      probe: 'tcp+tls+send+collector_api',
    }),
  )
  await ctx.dispose()
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
