#!/usr/bin/env npx tsx
/**
 * Build matrix-summary + capability-coverage reports from matrix-results.jsonl + full-matrix.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MatrixBundle } from '../scenarios/scenario-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

type ResultRow = {
  scenarioId: string
  status: string
  classification?: string
  detail?: string
  durationMs?: number
  suite?: string
  shard?: string
  executionMode?: string
  routeProcessing?: string
  capabilities?: string[]
  expectedStatus?: string
}

function main(): void {
  const runId = process.env.GDC_E2E_RUN_ID || process.argv[2] || 'matrix-local'
  const shard = process.env.GDC_E2E_SHARD_ARTIFACT_DIR?.trim()
  const runDir = shard
    ? path.join(root, 'reports', runId, shard)
    : path.join(root, 'reports', runId)
  const resultsPath = path.join(runDir, 'matrix-results.jsonl')
  // Also accept results at run root when shard-local file is empty
  const fallbackResults = path.join(root, 'reports', runId, 'matrix-results.jsonl')
  const matrixPath = path.join(root, 'scenarios', 'generated', 'full-matrix.json')
  const bundle = JSON.parse(fs.readFileSync(matrixPath, 'utf-8')) as MatrixBundle

  const rows: ResultRow[] = []
  const loadPath = fs.existsSync(resultsPath) ? resultsPath : fallbackResults
  if (fs.existsSync(loadPath)) {
    for (const line of fs.readFileSync(loadPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      rows.push(JSON.parse(line) as ResultRow)
    }
  }

  const byStatus: Record<string, number> = {}
  const bySuite: Record<string, Record<string, number>> = {}
  const byAuth: Record<string, { result: string; verified: boolean }> = {}
  const bySrcDest: Array<Record<string, string>> = []
  const byTransform: Array<Record<string, string>> = []
  const byFault: Array<Record<string, string>> = {} as unknown as Array<Record<string, string>>
  const faultRows: Array<Record<string, string>> = []
  const coveredCaps = new Set<string>()

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    const suite = r.suite || 'unknown'
    bySuite[suite] = bySuite[suite] || {}
    bySuite[suite][r.status] = (bySuite[suite][r.status] || 0) + 1
    for (const c of r.capabilities || []) coveredCaps.add(c)
  }

  const allCaps = new Set<string>()
  for (const s of bundle.scenarios) for (const c of s.capabilities) allCaps.add(c)

  const executedIds = new Set(rows.map((r) => r.scenarioId))
  const missingScenarios = bundle.scenarios.filter((s) => !executedIds.has(s.id)).map((s) => s.id)

  const summary = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    scenario_counts: bundle.counts,
    executed: rows.length,
    by_status: byStatus,
    by_suite: bySuite,
    missing_executed_scenarios: missingScenarios.length,
    missing_sample: missingScenarios.slice(0, 20),
    not_applicable: bundle.not_applicable,
  }

  const capabilityCoverage = {
    run_id: runId,
    total_capabilities_referenced: allCaps.size,
    capabilities_seen_in_results: coveredCaps.size,
    by_status: byStatus,
    by_suite: bySuite,
    browser_results: rows.filter((r) => r.executionMode === 'browser').length,
    api_seeded_results: rows.filter((r) => r.executionMode === 'api_seeded').length,
    route_off: rows.filter((r) => r.routeProcessing === 'off').length,
    route_on: rows.filter((r) => r.routeProcessing === 'on').length,
    unsupported_gaps: bundle.scenarios
      .filter((s) => s.expectedStatus === 'NOT_IMPLEMENTED')
      .map((s) => ({ id: s.id, reason: s.reason, capabilities: s.capabilities })),
  }

  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'matrix-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(runDir, 'capability-coverage.json'), `${JSON.stringify(capabilityCoverage, null, 2)}\n`)

  const md = [
    `# Capability Coverage — ${runId}`,
    '',
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Scenarios generated | ${bundle.counts.total} |`,
    `| Scenarios executed | ${rows.length} |`,
    `| PASS | ${byStatus.PASS || 0} |`,
    `| FAIL | ${byStatus.FAIL || 0} |`,
    `| BLOCKED | ${byStatus.BLOCKED || 0} |`,
    `| NOT_APPLICABLE | ${byStatus.NOT_APPLICABLE || 0} |`,
    `| NOT_IMPLEMENTED | ${byStatus.NOT_IMPLEMENTED || 0} |`,
    `| Browser | ${capabilityCoverage.browser_results} |`,
    `| API-Seeded | ${capabilityCoverage.api_seeded_results} |`,
    '',
    `## By suite`,
    '',
    ...Object.entries(bySuite).map(
      ([suite, st]) =>
        `- **${suite}**: ${Object.entries(st)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
    ),
    '',
    `## NOT_APPLICABLE`,
    '',
    ...bundle.not_applicable.map((n) => `- ${n.combination}: ${n.reason}`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(runDir, 'capability-coverage.md'), md)

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Matrix Summary ${runId}</title>
<style>body{font-family:ui-sans-serif,system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .6rem}</style>
</head><body>
<h1>Matrix Summary — ${runId}</h1>
<table><tr><th>Status</th><th>Count</th></tr>
${Object.entries(byStatus)
  .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
  .join('\n')}
</table>
<p>Executed ${rows.length} / ${bundle.counts.total} generated scenarios.</p>
</body></html>`
  fs.writeFileSync(path.join(runDir, 'matrix-summary.html'), html)

  // silence unused
  void byAuth
  void bySrcDest
  void byTransform
  void byFault
  void faultRows

  console.log(JSON.stringify({ ok: true, runId, executed: rows.length, byStatus }, null, 2))
}

main()
