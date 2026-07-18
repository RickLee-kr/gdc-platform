#!/usr/bin/env npx tsx
/**
 * Merge shard / multi-run Full Matrix results into a final report tree.
 *
 * Input:  e2e/reports/<run-id>/  (optionally with <shard>/ subdirs) OR --from <dir>
 * Output: e2e/reports/<run-id>/final/
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { E2EScenario, ExpectedStatus, MatrixBundle } from '../scenarios/scenario-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** Worst-first priority (lower index = worse). */
const STATUS_PRIORITY: ExpectedStatus[] = [
  'FAIL',
  'BLOCKED',
  'KNOWN_PRODUCT_GAP',
  'NOT_IMPLEMENTED',
  'PASS',
  'NOT_APPLICABLE',
]

export type MergedScenarioResult = {
  scenario_id: string
  suite: string
  execution_mode: string
  route_processing: string
  result: ExpectedStatus
  attempt_count: number
  last_attempt: string
  evidence_path: string
  failure_classification?: string
  reason?: string
  shard?: string
  capabilities?: string[]
  attempts: Array<{
    result: ExpectedStatus
    at: string
    evidence_path: string
    classification?: string
    reason?: string
  }>
}

function statusRank(s: string): number {
  const i = STATUS_PRIORITY.indexOf(s as ExpectedStatus)
  return i >= 0 ? i : STATUS_PRIORITY.length
}

function walkFiles(dir: string, name: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'final' || ent.name === 'node_modules' || ent.name === 'playwright-html') continue
      walkFiles(p, name, out)
    } else if (ent.name === name) {
      out.push(p)
    }
  }
  return out
}

function loadJsonl(file: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      /* skip bad line */
    }
  }
  return rows
}

function readResultJson(scenarioDir: string): {
  result: ExpectedStatus
  classification?: string
  reason?: string
  at: string
} | null {
  const resultPath = path.join(scenarioDir, 'result.json')
  if (!fs.existsSync(resultPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as Record<string, unknown>
    const status = String(raw.status || 'FAIL') as ExpectedStatus
    let classification = raw.classification ? String(raw.classification) : undefined
    const fcPath = path.join(scenarioDir, 'failure-classification.json')
    if (!classification && fs.existsSync(fcPath)) {
      const fc = JSON.parse(fs.readFileSync(fcPath, 'utf-8')) as { classification?: string }
      classification = fc.classification
    }
    const reason = raw.reason ? String(raw.reason) : raw.error ? String(raw.error) : undefined
    const st = fs.statSync(resultPath)
    return { result: status, classification, reason, at: st.mtime.toISOString() }
  } catch {
    return null
  }
}

function pickWinner(
  existing: MergedScenarioResult | undefined,
  candidate: MergedScenarioResult['attempts'][0],
  meta: Partial<MergedScenarioResult>,
): MergedScenarioResult {
  if (!existing) {
    return {
      scenario_id: meta.scenario_id!,
      suite: meta.suite || 'unknown',
      execution_mode: meta.execution_mode || 'api_seeded',
      route_processing: meta.route_processing || 'off',
      result: candidate.result,
      attempt_count: 1,
      last_attempt: candidate.at,
      evidence_path: candidate.evidence_path,
      failure_classification: candidate.classification,
      reason: candidate.reason,
      shard: meta.shard,
      capabilities: meta.capabilities,
      attempts: [candidate],
    }
  }

  const attempts = [...existing.attempts, candidate]
  attempts.sort((a, b) => a.at.localeCompare(b.at))
  const latest = attempts[attempts.length - 1]

  // Prefer worst status; but if latest attempt is a clear PASS, use latest success evidence.
  let winner = attempts.reduce((best, cur) => (statusRank(cur.result) < statusRank(best.result) ? cur : best))
  if (latest.result === 'PASS') {
    winner = latest
  }

  return {
    ...existing,
    ...meta,
    result: winner.result,
    attempt_count: attempts.length,
    last_attempt: latest.at,
    evidence_path: winner.evidence_path,
    failure_classification: winner.classification,
    reason: winner.reason,
    attempts,
  }
}

function parseArgs(): { runId: string; fromDir: string; outDir: string } {
  const args = process.argv.slice(2)
  let runId = process.env.GDC_E2E_RUN_ID || ''
  let fromDir = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') runId = args[++i] || runId
    else if (args[i] === '--from') fromDir = args[++i] || ''
    else if (!args[i].startsWith('-') && !runId) runId = args[i]
  }
  if (!runId) runId = 'merged-local'
  const base = fromDir || path.join(root, 'reports', runId)
  const outDir = path.join(root, 'reports', runId, 'final')
  return { runId, fromDir: base, outDir }
}

function main(): void {
  const { runId, fromDir, outDir } = parseArgs()
  const matrixPath = path.join(root, 'scenarios', 'generated', 'full-matrix.json')
  if (!fs.existsSync(matrixPath)) {
    console.error('Missing full-matrix.json — run npm run scenarios:generate first')
    process.exit(2)
  }
  const bundle = JSON.parse(fs.readFileSync(matrixPath, 'utf-8')) as MatrixBundle
  const byId = new Map(bundle.scenarios.map((s) => [s.id, s]))

  const merged = new Map<string, MergedScenarioResult>()

  // 1) Collect from matrix-results.jsonl
  for (const jsonl of walkFiles(fromDir, 'matrix-results.jsonl')) {
    for (const row of loadJsonl(jsonl)) {
      const id = String(row.scenarioId || row.scenario_id || '')
      if (!id) continue
      const scenario = byId.get(id)
      const evidenceDir = path.join(path.dirname(jsonl), id)
      const candidate = {
        result: String(row.status || row.result || 'FAIL') as ExpectedStatus,
        at: String(row.at || row.last_attempt || new Date().toISOString()),
        evidence_path: fs.existsSync(evidenceDir) ? evidenceDir : path.dirname(jsonl),
        classification: row.classification ? String(row.classification) : undefined,
        reason: row.detail ? String(row.detail) : row.reason ? String(row.reason) : undefined,
      }
      merged.set(
        id,
        pickWinner(merged.get(id), candidate, {
          scenario_id: id,
          suite: String(row.suite || scenario?.suite || 'unknown'),
          execution_mode: String(row.executionMode || row.execution_mode || scenario?.executionMode || 'api_seeded'),
          route_processing: String(
            row.routeProcessing || row.route_processing || scenario?.routeProcessing || 'off',
          ),
          shard: row.shard ? String(row.shard) : scenario?.shard,
          capabilities: (row.capabilities as string[]) || scenario?.capabilities,
        }),
      )
    }
  }

  // 2) Collect from result.json trees (fills gaps / adds attempts)
  for (const resultFile of walkFiles(fromDir, 'result.json')) {
    if (resultFile.includes(`${path.sep}final${path.sep}`)) continue
    const scenarioDir = path.dirname(resultFile)
    const id = path.basename(scenarioDir)
    if (id === 'final' || id.startsWith('.')) continue
    const parsed = readResultJson(scenarioDir)
    if (!parsed) continue
    const scenario = byId.get(id)
    const scenarioJsonPath = path.join(scenarioDir, 'scenario.json')
    let metaScenario: E2EScenario | undefined = scenario
    if (fs.existsSync(scenarioJsonPath)) {
      try {
        metaScenario = JSON.parse(fs.readFileSync(scenarioJsonPath, 'utf-8')) as E2EScenario
      } catch {
        /* ignore */
      }
    }
    const candidate = {
      result: parsed.result,
      at: parsed.at,
      evidence_path: scenarioDir,
      classification: parsed.classification,
      reason: parsed.reason,
    }
    merged.set(
      id,
      pickWinner(merged.get(id), candidate, {
        scenario_id: id,
        suite: metaScenario?.suite || 'unknown',
        execution_mode: metaScenario?.executionMode || 'api_seeded',
        route_processing: metaScenario?.routeProcessing || 'off',
        shard: metaScenario?.shard,
        capabilities: metaScenario?.capabilities,
      }),
    )
  }

  const results = [...merged.values()].sort((a, b) => a.scenario_id.localeCompare(b.scenario_id))
  const byStatus: Record<string, number> = {}
  for (const r of results) byStatus[r.result] = (byStatus[r.result] || 0) + 1

  const executedIds = new Set(results.map((r) => r.scenario_id))
  const missing = bundle.scenarios.filter((s) => !executedIds.has(s.id)).map((s) => s.id)

  const unresolved = results.filter((r) => {
    if (r.result === 'BLOCKED' && (!r.reason || !r.evidence_path)) return true
    if (r.result === 'KNOWN_PRODUCT_GAP' && (!r.reason || !r.evidence_path)) return true
    if (r.result === 'NOT_IMPLEMENTED' && !r.reason) return true
    return false
  })

  const productGaps = results.filter(
    (r) =>
      r.result === 'KNOWN_PRODUCT_GAP' ||
      r.failure_classification === 'KNOWN_PRODUCT_GAP' ||
      r.failure_classification === 'GOVERNANCE',
  )

  const browserResults = results.filter((r) => r.execution_mode === 'browser')
  const routeOff = results.filter((r) => r.route_processing === 'off' || String(r.scenario_id).includes('__route-off'))
  const routeOn = results.filter((r) => r.route_processing === 'on' || String(r.scenario_id).includes('__route-on'))

  const coveredCaps = new Set<string>()
  for (const r of results) for (const c of r.capabilities || []) coveredCaps.add(c)

  fs.mkdirSync(outDir, { recursive: true })

  const summary = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    source_dir: fromDir,
    total_generated: bundle.counts.total,
    executed: results.length,
    missing: missing.length,
    by_status: byStatus,
    browser_executed: browserResults.length,
    browser_generated: bundle.counts.browser,
    route_off_executed: routeOff.length,
    route_on_executed: routeOn.length,
    unresolved_count: unresolved.length,
    product_gap_count: productGaps.length,
  }

  const capabilityCoverage = {
    run_id: runId,
    capabilities_seen: coveredCaps.size,
    by_status: byStatus,
    browser_results: browserResults.length,
    route_off: routeOff.length,
    route_on: routeOn.length,
    missing_scenarios: missing,
  }

  fs.writeFileSync(path.join(outDir, 'matrix-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'capability-coverage.json'), `${JSON.stringify(capabilityCoverage, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'scenario-results.json'), `${JSON.stringify(results, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'unresolved-results.json'), `${JSON.stringify(unresolved, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'product-gaps.json'), `${JSON.stringify(productGaps, null, 2)}\n`)

  const md = [
    `# Capability Coverage — ${runId} (merged)`,
    '',
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Generated | ${bundle.counts.total} |`,
    `| Executed | ${results.length} |`,
    `| Missing | ${missing.length} |`,
    `| PASS | ${byStatus.PASS || 0} |`,
    `| FAIL | ${byStatus.FAIL || 0} |`,
    `| BLOCKED | ${byStatus.BLOCKED || 0} |`,
    `| KNOWN_PRODUCT_GAP | ${byStatus.KNOWN_PRODUCT_GAP || 0} |`,
    `| NOT_IMPLEMENTED | ${byStatus.NOT_IMPLEMENTED || 0} |`,
    `| NOT_APPLICABLE | ${byStatus.NOT_APPLICABLE || 0} |`,
    `| Browser | ${browserResults.length} / ${bundle.counts.browser} |`,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(outDir, 'capability-coverage.md'), md)

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Merged Matrix ${runId}</title>
<style>body{font-family:ui-sans-serif,system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .6rem}</style>
</head><body>
<h1>Merged Matrix Summary — ${runId}</h1>
<table><tr><th>Status</th><th>Count</th></tr>
${Object.entries(byStatus)
  .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
  .join('\n')}
</table>
<p>Executed ${results.length} / ${bundle.counts.total}. Missing ${missing.length}. Unresolved ${unresolved.length}.</p>
</body></html>`
  fs.writeFileSync(path.join(outDir, 'matrix-summary.html'), html)

  // Phase 4: run metadata for Release Gate evidence binding
  try {
    const repoRoot = path.resolve(root, '..')
    const gitCommit = () => {
      try {
        return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
      } catch {
        return 'unknown'
      }
    }
    const gitBranch = () => {
      try {
        return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
      } catch {
        return 'unknown'
      }
    }
    const hashFile = (p: string) => {
      if (!fs.existsSync(p)) return 'missing'
      return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
    const manifestPath = path.join(root, 'capabilities', 'data-relay-capabilities.yaml')
    const runMetadata = {
      git_commit: gitCommit(),
      git_branch: gitBranch(),
      workflow_run_id: process.env.GITHUB_RUN_ID || undefined,
      generated_at: summary.generated_at,
      manifest_hash: hashFile(manifestPath),
      scenario_hash: hashFile(matrixPath),
      route_flag: process.env.GDC_ROUTE_PROCESSING_ENABLED,
      execution_mode: process.env.GDC_E2E_EXECUTION_MODE || undefined,
      shard: process.env.GDC_E2E_SHARD || undefined,
      run_id: runId,
      execution_validation_pass: missing.length === 0 && !(byStatus.FAIL > 0),
    }
    fs.writeFileSync(path.join(outDir, 'run-metadata.json'), `${JSON.stringify(runMetadata, null, 2)}\n`)
  } catch (err) {
    console.warn('WARN: failed to write run-metadata.json', err)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        outDir,
        Total: bundle.counts.total,
        Executed: results.length,
        PASS: byStatus.PASS || 0,
        FAIL: byStatus.FAIL || 0,
        BLOCKED: byStatus.BLOCKED || 0,
        KNOWN_PRODUCT_GAP: byStatus.KNOWN_PRODUCT_GAP || 0,
        NOT_IMPLEMENTED: byStatus.NOT_IMPLEMENTED || 0,
        NOT_APPLICABLE: byStatus.NOT_APPLICABLE || 0,
        Missing: missing.length,
      },
      null,
      2,
    ),
  )
}

const isDirect =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('merge-matrix-results.ts'))

if (isDirect) {
  main()
}
