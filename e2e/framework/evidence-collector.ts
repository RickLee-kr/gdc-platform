/** Extended evidence collection for Phase 3 Full Matrix. */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { maskSecrets } from './fixture-client'
import type { EvidencePaths } from './scenario-types'
import type { FailureClassification } from '../scenarios/scenario-types'

const frameworkDir = path.dirname(fileURLToPath(import.meta.url))

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(maskSecrets(data), null, 2)}\n`, 'utf-8')
}

export class EvidenceCollector {
  readonly paths: EvidencePaths

  constructor(
    readonly runId: string,
    readonly scenarioId: string,
    rootDir = path.resolve(frameworkDir, '..', 'reports'),
  ) {
    const shard = process.env.GDC_E2E_SHARD_ARTIFACT_DIR?.trim()
    const runDir = shard ? path.join(rootDir, runId, shard) : path.join(rootDir, runId)
    const scenarioDir = path.join(runDir, scenarioId)
    ensureDir(scenarioDir)
    ensureDir(path.join(scenarioDir, 'service-logs'))
    this.paths = { runDir, scenarioDir }
  }

  writeText(name: string, content: string): string {
    const file = path.join(this.paths.scenarioDir, name)
    fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`, 'utf-8')
    return file
  }

  writeJsonFile(name: string, data: unknown): string {
    const file = path.join(this.paths.scenarioDir, name)
    writeJson(file, data)
    return file
  }

  recordScenario(scenario: unknown): void {
    this.writeJsonFile('scenario.json', scenario)
  }

  recordCapabilities(caps: string[]): void {
    this.writeJsonFile('capabilities.json', { capabilities: caps })
  }

  recordFixtureState(phase: 'before' | 'after', state: unknown): void {
    this.writeJsonFile(`fixture-state-${phase}.json`, state)
  }

  recordFailureClassification(classification: FailureClassification, detail: string): void {
    this.writeJsonFile('failure-classification.json', {
      classification,
      detail,
      at: new Date().toISOString(),
    })
  }

  async captureScreenshot(page: Page | null, name = 'screenshot.png'): Promise<string | null> {
    if (!page) return null
    const file = path.join(this.paths.scenarioDir, name)
    await page.screenshot({ path: file, fullPage: true }).catch(() => null)
    return file
  }

  async attachTraceHint(testInfo: TestInfo): Promise<void> {
    this.writeText('playwright-trace-hint.txt', `Use Playwright trace from testInfo attachments. test=${testInfo.title}\n`)
  }

  recordUiUrl(url: string): void {
    this.writeText('ui-url.txt', url)
  }

  async collectApiBundle(
    request: APIRequestContext,
    apiBase: string,
    streamId: number | null,
    opts?: { accessToken?: string | null },
  ): Promise<void> {
    const headers: Record<string, string> = {}
    if (opts?.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`
    const get = async (url: string) => {
      const res = await request.get(url, { headers })
      const text = await res.text()
      try {
        return { status: res.status(), body: JSON.parse(text) }
      } catch {
        return { status: res.status(), body: text }
      }
    }

    const health = await get(`${apiBase}/health`).catch((e) => ({ error: String(e) }))
    this.writeJsonFile('api-state.json', { health, route_flag_env: process.env.GDC_ROUTE_PROCESSING_ENABLED })

    if (streamId == null) return

    const stream = await get(`${apiBase}/api/v1/streams/${streamId}`).catch((e) => ({ error: String(e) }))
    this.writeJsonFile('stream-config.json', stream)

    const runtime = await get(`${apiBase}/api/v1/runtime/streams/${streamId}/stats-health`).catch((e) => ({
      error: String(e),
    }))
    this.writeJsonFile('runtime-status.json', runtime)

    const checkpoint = await get(`${apiBase}/api/v1/runtime/streams/${streamId}/checkpoint`).catch((e) => ({
      error: String(e),
    }))
    this.writeJsonFile('checkpoint.json', checkpoint)

    const logs = await get(`${apiBase}/api/v1/runtime/logs/search?stream_id=${streamId}&limit=50&window=1h`).catch(
      async (e) => {
        const alt = await get(`${apiBase}/api/v1/runtime/streams/${streamId}/delivery-logs?limit=50`).catch((e2) => ({
          error: String(e2),
        }))
        return { primary_error: String(e), alt }
      },
    )
    this.writeJsonFile('delivery-logs.json', logs)

    const routes = await get(`${apiBase}/api/v1/routes/?stream_id=${streamId}`).catch((e) => ({ error: String(e) }))
    this.writeJsonFile('route-config.json', routes)

    const routeMetrics = await get(`${apiBase}/api/v1/runtime/streams/${streamId}/stats-health`).catch((e) => ({
      error: String(e),
    }))
    this.writeJsonFile('route-metrics.json', routeMetrics)
  }

  async collectGovernanceBundle(request: APIRequestContext, apiBase: string, token?: string | null): Promise<void> {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const get = async (p: string) => {
      try {
        const res = await Promise.race([
          request.get(`${apiBase}${p}`, { headers }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`governance bundle timeout: ${p}`)), 10_000),
          ),
        ])
        const text = await res.text()
        try {
          return { status: res.status(), body: JSON.parse(text) }
        } catch {
          return { status: res.status(), body: text }
        }
      } catch (err) {
        return { error: String(err), path: p }
      }
    }
    this.writeJsonFile('governance-state.json', await get('/api/v1/governance/audit?limit=20'))
    this.writeJsonFile('quarantine-state.json', await get('/api/v1/governance/quarantine?limit=50'))
    this.writeJsonFile('replay-state.json', await get('/api/v1/governance/replay?limit=20'))
  }
}
