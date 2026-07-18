import { chromium, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { executeScenario } from '../framework/matrix-executor'
import { filterScenarios } from '../framework/matrix-loader'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExpectedStatus, FailureClassification } from '../scenarios/scenario-types'

const RUN_ID = process.env.GDC_E2E_RUN_ID
const SHARD_DIR = process.env.GDC_E2E_SHARD_ARTIFACT_DIR?.trim()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runBase = path.join(root, 'reports', RUN_ID || 'matrix-local', ...(SHARD_DIR ? [SHARD_DIR] : []))
const resultsFile = path.join(runBase, 'matrix-results.jsonl')

/** Infra-only retry classifications / message patterns. Product failures must not retry. */
const INFRA_RETRY_CLASSIFICATIONS = new Set<FailureClassification>(['TEST_INFRA'])
const INFRA_RETRY_PATTERNS = [
  /browser.*launch/i,
  /browser.*startup/i,
  /browser process startup/i,
  /target closed/i,
  /browser has been closed/i,
  /context or browser has been closed/i,
  /request context disposed/i,
  /Target page, context or browser has been closed/i,
  /container health/i,
  /fixture reset/i,
]

const MAX_INFRA_RETRIES = Math.max(0, Number(process.env.GDC_E2E_INFRA_RETRIES || '2'))

function appendResult(row: unknown): void {
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true })
  fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`, 'utf-8')
}

function isInfraRetryable(err: unknown, classification?: FailureClassification): boolean {
  if (classification && INFRA_RETRY_CLASSIFICATIONS.has(classification)) return true
  const msg = String(err)
  return INFRA_RETRY_PATTERNS.some((re) => re.test(msg))
}

function isProductFailure(classification?: FailureClassification, status?: ExpectedStatus): boolean {
  if (status === 'KNOWN_PRODUCT_GAP') return true
  if (!classification) return false
  return ['UI', 'API', 'PERSISTENCE', 'RUNTIME', 'ROUTE', 'GOVERNANCE', 'KNOWN_PRODUCT_GAP'].includes(classification)
}

const scenarios = filterScenarios({
  suite: process.env.GDC_E2E_SUITE,
  shard: process.env.GDC_E2E_SHARD,
})

if (scenarios.length === 0) {
  test('matrix filter produced zero scenarios', async () => {
    throw new Error(
      `No scenarios matched filters (suite=${process.env.GDC_E2E_SUITE || ''} shard=${process.env.GDC_E2E_SHARD || ''} ids=${process.env.GDC_E2E_SCENARIO_IDS || ''})`,
    )
  })
}

test.describe(`Full Matrix (${process.env.GDC_E2E_SHARD || process.env.GDC_E2E_SUITE || 'all'})`, () => {
  for (const scenario of scenarios) {
    // Use only `request` fixture by default so api_seeded scenarios do not require Chromium.
    test(`${scenario.id} [${scenario.executionMode}/${scenario.routeProcessing}]`, async ({ request }, testInfo) => {
      testInfo.setTimeout(180_000)
      let ownedBrowser: Browser | null = null
      let page: Page | null = null
      if (scenario.executionMode === 'browser') {
        ownedBrowser = await chromium.launch()
        page = await ownedBrowser.newPage()
      }

      const attempts: Array<Record<string, unknown>> = []
      let lastError: unknown = null
      let finalResult: Awaited<ReturnType<typeof executeScenario>> | null = null

      try {
        for (let attempt = 1; attempt <= MAX_INFRA_RETRIES + 1; attempt++) {
          try {
            if (scenario.executionMode === 'browser' && (!page || page.isClosed())) {
              if (!ownedBrowser) ownedBrowser = await chromium.launch()
              page = await ownedBrowser.newPage()
            }
            const result = await executeScenario({
              scenario,
              request,
              page: page as Page,
              testInfo,
              runId: RUN_ID,
            })
            attempts.push({
              attempt,
              status: result.status,
              classification: result.classification,
              detail: result.detail,
              at: new Date().toISOString(),
            })
            finalResult = result
            lastError = null
            break
          } catch (err) {
            lastError = err
            const classification = (err as { classification?: FailureClassification }).classification
            attempts.push({
              attempt,
              status: 'FAIL',
              classification,
              detail: String(err),
              at: new Date().toISOString(),
            })
            const canRetry =
              attempt <= MAX_INFRA_RETRIES &&
              isInfraRetryable(err, classification) &&
              !isProductFailure(classification)
            if (!canRetry) break
            // brief backoff for infra flakes
            await new Promise((r) => setTimeout(r, 1500 * attempt))
          }
        }

        if (finalResult) {
          appendResult({
            ...finalResult,
            suite: scenario.suite,
            shard: scenario.shard,
            executionMode: scenario.executionMode,
            routeProcessing: scenario.routeProcessing,
            capabilities: scenario.capabilities,
            expectedStatus: scenario.expectedStatus,
            attempt_count: attempts.length,
            attempts,
          })
          if (finalResult.status === 'FAIL') {
            throw new Error(finalResult.detail || 'scenario FAIL')
          }
        } else if (lastError) {
          appendResult({
            scenarioId: scenario.id,
            status: 'FAIL',
            classification: (lastError as { classification?: string }).classification,
            detail: String(lastError),
            durationMs: 0,
            suite: scenario.suite,
            shard: scenario.shard,
            executionMode: scenario.executionMode,
            routeProcessing: scenario.routeProcessing,
            capabilities: scenario.capabilities,
            expectedStatus: scenario.expectedStatus,
            attempt_count: attempts.length,
            attempts,
          })
          throw lastError
        }
      } finally {
        if (page) await page.close().catch(() => null)
        if (ownedBrowser) await ownedBrowser.close().catch(() => null)
      }
    })
  }
})
