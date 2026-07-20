import { chromium, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterCrossProductScenarios } from '../cross-product-loader'
import { executeCrossProductScenario } from '../cross-product-executor'
import { computeHarnessVersion, writeHarnessManifest } from '../harness-version'

const RUN_ID = process.env.GDC_E2E_RUN_ID || process.env.GDC_XP_RUN_ID || 'xp-local'
const SHARD_DIR = process.env.GDC_E2E_SHARD_ARTIFACT_DIR?.trim() || process.env.GDC_XP_SHARD || ''
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runBase = path.join(root, 'reports', RUN_ID, ...(SHARD_DIR ? [SHARD_DIR] : []))
const resultsFile = path.join(runBase, 'cross-product-results.jsonl')

/** Computed once per Playwright worker/process at shard start. */
const HARNESS = computeHarnessVersion()
writeHarnessManifest(runBase, HARNESS)

function appendResult(row: unknown): void {
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true })
  fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`, 'utf-8')
}

const scenarios = filterCrossProductScenarios()

if (scenarios.length === 0) {
  test('cross-product filter produced zero scenarios', async () => {
    throw new Error(
      `No cross-product scenarios matched (shard=${process.env.GDC_XP_SHARD || ''} limit=${process.env.GDC_XP_LIMIT || ''})`,
    )
  })
}

test.describe(`Cross-Product (${process.env.GDC_XP_SHARD || 'all'})`, () => {
  for (const scenario of scenarios) {
    test(`${scenario.id} [${scenario.executionMode}/${scenario.routeProcessing}]`, async ({
      request,
    }, testInfo) => {
      testInfo.setTimeout(240_000)
      let ownedBrowser: Browser | null = null
      let page: Page | null = null
      if (scenario.executionMode === 'browser') {
        ownedBrowser = await chromium.launch()
        page = await ownedBrowser.newPage()
      }
      try {
        const result = await executeCrossProductScenario({
          scenario,
          request,
          page,
          testInfo,
          runId: RUN_ID,
        })
        appendResult({
          ...result,
          finishedAt: new Date().toISOString(),
          shard: process.env.GDC_XP_SHARD || '',
          commit: process.env.GDC_XP_COMMIT || HARNESS.git_commit,
          git_commit: process.env.GDC_XP_COMMIT || HARNESS.git_commit,
          manifest_hash: process.env.GDC_XP_MANIFEST_HASH || HARNESS.manifest_hash,
          applicability_rules_hash: process.env.GDC_XP_RULES_HASH || HARNESS.applicability_rules_hash,
          axes_hash: process.env.GDC_XP_AXES_HASH || HARNESS.axes_hash,
          executor_hash: HARNESS.executor_hash,
          driver_hash: HARNESS.driver_hash,
          spec_hash: HARNESS.spec_hash,
          oracle_hash: HARNESS.oracle_hash,
          fixture_hash: HARNESS.fixture_hash,
          harness_version: HARNESS.harness_version,
        })
        if (result.status === 'FAIL' || result.status === 'BLOCKED' || result.status === 'GAP') {
          throw new Error(`${result.status}: ${result.detail || result.classification || ''}`)
        }
      } finally {
        await ownedBrowser?.close().catch(() => undefined)
      }
    })
  }
})
