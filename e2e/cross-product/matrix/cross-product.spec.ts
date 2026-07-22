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
const sideRoot = path.join(root, 'reports', RUN_ID)
const resultsFile = path.join(runBase, 'cross-product-results.jsonl')
const writerLockFile = path.join(runBase, 'writer.lock')
const runGenerationFile = path.join(sideRoot, 'run-generation.json')

const GENERATION_ID = process.env.GDC_XP_GENERATION_ID?.trim() || ''
const ATTEMPT = process.env.GDC_XP_ATTEMPT?.trim() || ''
const SHARD = process.env.GDC_XP_SHARD?.trim() || ''

/** Computed once per Playwright worker/process at shard start. */
const HARNESS = computeHarnessVersion()
writeHarnessManifest(runBase, HARNESS)

type RunGenerationManifest = {
  generation_id?: string
  attempt?: string
  shard?: string
  commit?: string
  harness_version?: string
  status?: string
}

type WriterLock = {
  generation_id?: string
  attempt?: string
  shard?: string
  commit?: string
  harness_version?: string
  pid?: number
  status?: string
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function assertWriterOwnership(): void {
  // Generation isolation is mandatory when resume/orchestrator sets GDC_XP_GENERATION_ID.
  if (!GENERATION_ID) {
    // Legacy non-resume local runs remain append-compatible, but never against a foreign lock.
    if (fs.existsSync(writerLockFile)) {
      const lock = readJsonFile<WriterLock>(writerLockFile)
      if (lock?.generation_id) {
        throw new Error('RESULT_WRITER_NOT_OWNER: writer.lock present without GDC_XP_GENERATION_ID')
      }
    }
    return
  }

  const man = readJsonFile<RunGenerationManifest>(runGenerationFile)
  if (!man) {
    throw new Error('RESULT_WRITER_MANIFEST_MISSING')
  }
  if (man.generation_id !== GENERATION_ID) {
    throw new Error(
      `RESULT_WRITER_GENERATION_MISMATCH: manifest=${man.generation_id} writer=${GENERATION_ID}`,
    )
  }
  if (ATTEMPT && man.attempt && man.attempt !== ATTEMPT) {
    throw new Error(`RESULT_WRITER_GENERATION_MISMATCH: attempt manifest=${man.attempt} env=${ATTEMPT}`)
  }
  if (SHARD && man.shard && man.shard !== SHARD) {
    throw new Error(`RESULT_WRITER_GENERATION_MISMATCH: shard manifest=${man.shard} env=${SHARD}`)
  }
  const expectedCommit = process.env.GDC_XP_COMMIT || HARNESS.git_commit
  if (man.commit && expectedCommit && man.commit !== expectedCommit) {
    throw new Error('RESULT_WRITER_GENERATION_MISMATCH: commit')
  }
  if (man.harness_version && man.harness_version !== HARNESS.harness_version) {
    // Soft: live harness may recompute; prefer expected env when pinned.
    const pinned = process.env.GDC_XP_EXPECTED_HARNESS
    if (pinned && man.harness_version !== pinned) {
      throw new Error('RESULT_WRITER_GENERATION_MISMATCH: harness')
    }
  }
  if (String(man.status || '').toUpperCase() !== 'RUNNING') {
    throw new Error(`RESULT_WRITER_NOT_OWNER: generation status=${man.status}`)
  }

  const lock = readJsonFile<WriterLock>(writerLockFile)
  if (!lock) {
    throw new Error('RESULT_WRITER_NOT_OWNER: writer.lock missing')
  }
  if (lock.generation_id !== GENERATION_ID) {
    throw new Error('RESULT_WRITER_GENERATION_MISMATCH: writer.lock generation')
  }

  if (fs.existsSync(resultsFile) && fs.statSync(resultsFile).size > 0) {
    const firstLine = fs.readFileSync(resultsFile, 'utf-8').split('\n').find((l) => l.trim())
    if (firstLine) {
      try {
        const row = JSON.parse(firstLine) as { generation_id?: string }
        if (row.generation_id && row.generation_id !== GENERATION_ID) {
          throw new Error('RESULT_WRITER_GENERATION_MISMATCH: existing JSONL generation')
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('RESULT_WRITER_')) throw err
        throw new Error('RESULT_WRITER_GENERATION_MISMATCH: unreadable existing JSONL')
      }
    }
  }
}

function appendResult(row: unknown): void {
  assertWriterOwnership()
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
          attempt: ATTEMPT || undefined,
          generation_id: GENERATION_ID || undefined,
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
