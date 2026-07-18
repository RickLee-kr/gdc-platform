/**
 * Compute and persist Cross-Product harness version hashes.
 * Hashes are content-based (sha256 of file bytes) for the files that execute scenarios.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E = path.resolve(__dirname, '..')
const ROOT = path.resolve(E2E, '..')
const GEN = path.join(__dirname, 'generated')

export type HarnessVersion = {
  executor_hash: string
  driver_hash: string
  spec_hash: string
  oracle_hash: string
  fixture_hash: string
  harness_version: string
  git_commit: string
  manifest_hash: string
  applicability_rules_hash: string
  axes_hash: string
  computed_at: string
}

const HARNESS_FILES = {
  executor: path.join(__dirname, 'cross-product-executor.ts'),
  driver: path.join(E2E, 'framework/data-relay-driver.ts'),
  spec: path.join(__dirname, 'matrix/cross-product.spec.ts'),
  oracle: path.join(__dirname, 'oracle.ts'),
  fixture: path.join(__dirname, 'fixtures/composite-chain-fixture.ts'),
  applicability: path.join(__dirname, 'applicability-rules.ts'),
} as const

function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex')
}

function readGenerationHashes(): {
  manifest_hash: string
  applicability_rules_hash: string
  axes_hash: string
} {
  const summaryPath = path.join(GEN, 'generation-summary.json')
  if (!fs.existsSync(summaryPath)) {
    return { manifest_hash: '', applicability_rules_hash: '', axes_hash: '' }
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, string>
  return {
    manifest_hash: String(summary.manifest_hash || ''),
    applicability_rules_hash: String(summary.applicability_rules_hash || ''),
    axes_hash: String(summary.axes_hash || ''),
  }
}

function gitCommit(): string {
  try {
    const head = path.join(ROOT, '.git/HEAD')
    if (!fs.existsSync(head)) return 'unknown'
    const ref = fs.readFileSync(head, 'utf-8').trim()
    if (ref.startsWith('ref:')) {
      const refPath = path.join(ROOT, '.git', ref.slice(5).trim())
      if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf-8').trim()
    }
    return ref.slice(0, 40) || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Compute harness version once per process (shard start). */
let cached: HarnessVersion | null = null

export function computeHarnessVersion(): HarnessVersion {
  if (cached) return cached
  const executor_hash = sha256File(HARNESS_FILES.executor)
  const driver_hash = sha256File(HARNESS_FILES.driver)
  const spec_hash = sha256File(HARNESS_FILES.spec)
  const oracle_hash = sha256File(HARNESS_FILES.oracle)
  const fixture_hash = sha256File(HARNESS_FILES.fixture)
  const gen = readGenerationHashes()
  const git_commit = process.env.GDC_XP_COMMIT || gitCommit()
  const harness_version = sha256Text(
    [
      executor_hash,
      driver_hash,
      spec_hash,
      oracle_hash,
      fixture_hash,
      git_commit,
      gen.manifest_hash,
      gen.applicability_rules_hash,
      gen.axes_hash,
    ].join('\n'),
  )
  cached = {
    executor_hash,
    driver_hash,
    spec_hash,
    oracle_hash,
    fixture_hash,
    harness_version,
    git_commit,
    manifest_hash: gen.manifest_hash,
    applicability_rules_hash: gen.applicability_rules_hash,
    axes_hash: gen.axes_hash,
    computed_at: new Date().toISOString(),
  }
  return cached
}

export function harnessVersionEqual(a: Partial<HarnessVersion>, b: Partial<HarnessVersion>): boolean {
  return (
    String(a.harness_version || '') === String(b.harness_version || '') &&
    String(a.executor_hash || '') === String(b.executor_hash || '') &&
    String(a.driver_hash || '') === String(b.driver_hash || '') &&
    String(a.spec_hash || '') === String(b.spec_hash || '') &&
    String(a.oracle_hash || '') === String(b.oracle_hash || '') &&
    String(a.fixture_hash || '') === String(b.fixture_hash || '')
  )
}

export function writeHarnessManifest(dir: string, version: HarnessVersion = computeHarnessVersion()): string {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'harness-manifest.json')
  fs.writeFileSync(out, `${JSON.stringify(version, null, 2)}\n`)
  return out
}

/**
 * Full-run preflight: refuse residual filters.
 * Call only from full-shard orchestrators (run-all-shards / rerun-full-shard).
 * Preflight and explicit limited re-runs must NOT call this (they set filters intentionally).
 */
export function assertFullRunEnvClean(): void {
  const ids = process.env.GDC_XP_COMBINATION_IDS?.trim()
  const limit = process.env.GDC_XP_LIMIT?.trim()
  if (ids || limit) {
    throw new Error(
      `Full shard run refuses residual filters: GDC_XP_COMBINATION_IDS=${ids || '(unset)'} GDC_XP_LIMIT=${limit || '(unset)'}`,
    )
  }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('harness-version.ts'))

if (isMain) {
  const v = computeHarnessVersion()
  console.log(JSON.stringify(v, null, 2))
}
