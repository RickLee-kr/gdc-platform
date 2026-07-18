/**
 * Phase 3.2 failure triage runner.
 *
 * Loads failure-inventory.json, runs each scenario independently with fixture reset,
 * optionally retries once for infra-only disposed-context errors, classifies outcomes,
 * and writes triage-results.json under e2e/reports/phase32_triage/.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '..')
const triageDir = path.join(root, 'reports', 'phase32_triage')
const inventoryPath = path.join(triageDir, 'failure-inventory.json')

const INFRA_RETRY_PATTERNS = [
  /request context disposed/i,
  /browser.*startup/i,
  /browser.*launch/i,
  /container health/i,
  /fixture reset/i,
  /Target page, context or browser has been closed/i,
  /ECONNREFUSED/i,
  /connect ECONNREFUSED/i,
  /server closed the connection unexpectedly/i,
  /API.*not ready|lab up failed/i,
]

const NO_RETRY_PATTERNS = [
  /block behavior delivered/i,
  /collector/i,
  /authentication/i,
  /checkpoint/i,
  /governance/i,
  /validation/i,
  /payload/i,
  /HTTP 4\d\d/i,
]

type InventoryItem = {
  scenario_id: string
  suite?: string
  execution_mode?: string
  route_processing?: string
  previous_result?: string
  failure_message?: string
  suspected_cause?: string
}

type TriageRow = {
  scenario_id: string
  suite?: string
  execution_mode?: string
  route_processing?: string
  previous_result?: string
  attempt_1?: Record<string, unknown>
  attempt_2?: Record<string, unknown>
  final_result: string
  failure_classification: string
  failure_message?: string
  evidence_path?: string
  suspected_cause?: string
  notes?: string
}

function parseArgs(argv: string[]): {
  runId: string
  limit?: number
  ids?: string[]
  resume: boolean
} {
  let runId = process.env.GDC_E2E_RUN_ID || `phase32_triage_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  let limit: number | undefined
  let ids: string[] | undefined
  let resume = true
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--run-id') runId = argv[++i]
    else if (a.startsWith('--run-id=')) runId = a.slice('--run-id='.length)
    else if (a === '--limit') limit = Number(argv[++i])
    else if (a.startsWith('--limit=')) limit = Number(a.slice('--limit='.length))
    else if (a === '--ids') ids = argv[++i].split(/[,\s]+/).filter(Boolean)
    else if (a.startsWith('--ids=')) ids = a.slice('--ids='.length).split(/[,\s]+/).filter(Boolean)
    else if (a === '--no-resume') resume = false
  }
  return { runId, limit, ids, resume }
}

function loadInventory(): InventoryItem[] {
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`missing inventory: ${inventoryPath}`)
  }
  const raw = JSON.parse(fs.readFileSync(inventoryPath, 'utf-8')) as { items?: InventoryItem[] }
  return raw.items || []
}

function isInfraRetryable(detail: string): boolean {
  if (NO_RETRY_PATTERNS.some((re) => re.test(detail) && !/request context disposed/i.test(detail))) {
    if (!/request context disposed|browser has been closed|fixture reset|container health/i.test(detail)) {
      return false
    }
  }
  return INFRA_RETRY_PATTERNS.some((re) => re.test(detail))
}

function classifyFinal(previous: string | undefined, result: string, detail: string, suspected?: string): string {
  if (result === 'PASS') return 'PASS'
  if (result === 'NOT_IMPLEMENTED') return 'NOT_IMPLEMENTED'
  if (result === 'KNOWN_PRODUCT_GAP') return 'KNOWN_PRODUCT_GAP'
  // Infra signals win over suspected product cause (e.g. API down during reset).
  if (
    /request context disposed|browser has been closed|fixture reset|container health|ECONNREFUSED|server closed the connection unexpectedly|lab up failed/i.test(
      detail,
    )
  ) {
    return 'FAIL_TEST_INFRA'
  }
  if (result === 'BLOCKED') {
    return 'FAIL_PRODUCT'
  }
  if (suspected === 'governance_block_runtime' || /block behavior delivered/i.test(detail)) {
    return 'FAIL_PRODUCT'
  }
  if (previous === 'KNOWN_PRODUCT_GAP' && /block/i.test(detail)) return 'FAIL_PRODUCT'
  return 'FAIL_PRODUCT'
}

function ensureLab(routeProcessing: string, runId: string): { ok: boolean; detail?: string } {
  const route = routeProcessing === 'on' ? 'on' : 'off'
  const env = {
    ...process.env,
    GDC_E2E_RUN_ID: runId,
    GDC_E2E_KEEP_UP: '1',
    GDC_E2E_INFRA_RETRIES: '0',
  }
  const script = path.join(root, 'run-full-e2e-lab.sh')
  const up = spawnSync('bash', [script, 'up', `--route-processing=${route}`], {
    cwd: repoRoot,
    env,
    encoding: 'utf-8',
  })
  if (up.status !== 0) {
    return { ok: false, detail: `lab up failed: ${up.stderr || up.stdout}` }
  }
  return { ok: true }
}

function runScenarioOnce(opts: {
  scenarioId: string
  routeProcessing: string
  runId: string
  ensureLabFirst: boolean
}): { exitCode: number; result?: string; detail?: string; evidencePath?: string; raw?: unknown } {
  const route = opts.routeProcessing === 'on' ? 'on' : 'off'
  const env = {
    ...process.env,
    GDC_E2E_RUN_ID: opts.runId,
    GDC_E2E_SCENARIO_IDS: opts.scenarioId,
    GDC_E2E_KEEP_UP: '1',
    GDC_E2E_INFRA_RETRIES: '0',
  }
  const script = path.join(root, 'run-full-e2e-lab.sh')

  if (opts.ensureLabFirst) {
    const up = ensureLab(route, opts.runId)
    if (!up.ok) {
      return { exitCode: 1, result: 'FAIL', detail: up.detail }
    }
  }

  const reset = spawnSync('bash', [script, 'reset'], { cwd: repoRoot, env, encoding: 'utf-8' })
  if (reset.status !== 0) {
    return {
      exitCode: reset.status ?? 1,
      result: 'FAIL',
      detail: `fixture reset failed: ${reset.stderr || reset.stdout}`,
    }
  }

  // Keep leftover FULL E2E streams from flooding the API between scenarios.
  spawnSync(
    'python3',
    [
      '-c',
      "from sqlalchemy import create_engine,text; e=create_engine('postgresql://gdc:gdc@127.0.0.1:55441/gdc');\n" +
        "with e.begin() as c: c.execute(text(\"UPDATE streams SET enabled=false, status='STOPPED' WHERE enabled=true OR status='RUNNING'\"))",
    ],
    { cwd: repoRoot, env, encoding: 'utf-8' },
  )

  const test = spawnSync(
    'npx',
    ['playwright', 'test', '-c', 'playwright.config.ts', '--project=matrix'],
    {
      cwd: root,
      env: {
        ...env,
        GDC_ROUTE_PROCESSING_ENABLED: route === 'on' ? 'true' : 'false',
        PLAYWRIGHT_API_BASE_URL: process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:18000',
      },
      encoding: 'utf-8',
    },
  )
  const resultsFile = path.join(root, 'reports', opts.runId, 'matrix-results.jsonl')
  let result = 'FAIL'
  let detail = test.stderr || test.stdout || `exit=${test.status}`
  let evidencePath: string | undefined
  let raw: unknown
  if (fs.existsSync(resultsFile)) {
    const lines = fs.readFileSync(resultsFile, 'utf-8').trim().split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    if (last) {
      try {
        const row = JSON.parse(last) as {
          scenarioId?: string
          status?: string
          detail?: string
          evidence_path?: string
          evidencePath?: string
        }
        raw = row
        if (row.scenarioId === opts.scenarioId || lines.length === 1) {
          result = String(row.status || 'FAIL')
          detail = String(row.detail || detail)
          evidencePath = row.evidence_path || row.evidencePath
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (test.status === 0 && result === 'FAIL' && /1 passed/i.test(detail)) {
    result = 'PASS'
  }
  const evidenceDir = path.join(root, 'reports', opts.runId)
  if (!evidencePath && fs.existsSync(evidenceDir)) {
    const match = fs
      .readdirSync(evidenceDir, { withFileTypes: true })
      .find((d) => d.isDirectory() && d.name.includes(opts.scenarioId))
    if (match) evidencePath = path.join(evidenceDir, match.name)
  }
  return { exitCode: test.status ?? 1, result, detail, evidencePath, raw }
}

function loadExistingRow(scenarioId: string): TriageRow | null {
  const p = path.join(triageDir, 'scenarios', scenarioId, 'triage.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as TriageRow
  } catch {
    return null
  }
}

function writeOutputs(runId: string, rows: TriageRow[]): void {
  const unresolved = rows.filter(
    (r) =>
      ['PENDING_TRIAGE', 'FAIL_TEST_INFRA', 'FAIL'].includes(r.failure_classification) ||
      (r.final_result !== 'PASS' && !r.failure_classification),
  )
  const summary = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    total: rows.length,
    by_classification: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.failure_classification] = (acc[r.failure_classification] || 0) + 1
      return acc
    }, {}),
    by_final_result: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.final_result] = (acc[r.final_result] || 0) + 1
      return acc
    }, {}),
  }

  fs.writeFileSync(path.join(triageDir, 'triage-results.json'), JSON.stringify({ summary, results: rows }, null, 2) + '\n')
  fs.writeFileSync(path.join(triageDir, 'unresolved-results.json'), JSON.stringify(unresolved, null, 2) + '\n')
  fs.writeFileSync(path.join(triageDir, 'triage-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(triageDir, { recursive: true })
  let items = loadInventory()
  if (args.ids?.length) {
    const set = new Set(args.ids)
    items = items.filter((i) => set.has(i.scenario_id))
  }
  if (args.limit && args.limit > 0) items = items.slice(0, args.limit)

  // Prefer route-off first so API restarts once when flipping to route-on.
  items = [...items].sort((a, b) => {
    const ar = a.route_processing === 'on' ? 1 : 0
    const br = b.route_processing === 'on' ? 1 : 0
    if (ar !== br) return ar - br
    return a.scenario_id.localeCompare(b.scenario_id)
  })

  const rows: TriageRow[] = []
  let lastRoute: string | null = null

  for (const item of items) {
    const route = item.route_processing === 'on' ? 'on' : 'off'
    if (args.resume) {
      const existing = loadExistingRow(item.scenario_id)
      if (existing && existing.failure_classification && existing.failure_classification !== 'PENDING_TRIAGE') {
        console.log(`==> skip (resume) ${item.scenario_id} => ${existing.failure_classification}`)
        rows.push(existing)
        lastRoute = route
        continue
      }
    }

    const scenarioRunId = `${args.runId}_${item.scenario_id}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)
    console.log(`==> triage ${item.scenario_id} route=${route}`)
    const ensureLabFirst = lastRoute !== route
    const first = runScenarioOnce({
      scenarioId: item.scenario_id,
      routeProcessing: route,
      runId: scenarioRunId,
      ensureLabFirst,
    })
    lastRoute = route
    let finalResult = String(first.result || 'FAIL')
    let finalDetail = String(first.detail || '')
    let attempt2: Record<string, unknown> | undefined
    let notes = ''

    if (finalResult !== 'PASS' && isInfraRetryable(finalDetail)) {
      notes = 'infra_retry_once'
      const second = runScenarioOnce({
        scenarioId: item.scenario_id,
        routeProcessing: route,
        runId: `${scenarioRunId}_retry`,
        ensureLabFirst: false,
      })
      attempt2 = {
        result: second.result,
        detail: second.detail,
        evidence_path: second.evidencePath,
        exit_code: second.exitCode,
      }
      finalResult = String(second.result || 'FAIL')
      finalDetail = String(second.detail || finalDetail)
    }

    const classification = classifyFinal(item.previous_result, finalResult, finalDetail, item.suspected_cause)
    const row: TriageRow = {
      scenario_id: item.scenario_id,
      suite: item.suite,
      execution_mode: item.execution_mode,
      route_processing: route,
      previous_result: item.previous_result,
      attempt_1: {
        result: first.result,
        detail: first.detail,
        evidence_path: first.evidencePath,
        exit_code: first.exitCode,
      },
      attempt_2: attempt2,
      final_result: finalResult === 'PASS' ? 'PASS' : classification,
      failure_classification: classification,
      failure_message: finalDetail.slice(0, 2000),
      evidence_path: (attempt2?.evidence_path as string | undefined) || first.evidencePath,
      suspected_cause: item.suspected_cause,
      notes,
    }
    rows.push(row)

    const scenarioOut = path.join(triageDir, 'scenarios', item.scenario_id)
    fs.mkdirSync(scenarioOut, { recursive: true })
    fs.writeFileSync(path.join(scenarioOut, 'triage.json'), JSON.stringify(row, null, 2) + '\n')
    // Incremental summary so long runs remain inspectable.
    writeOutputs(args.runId, rows)
  }

  writeOutputs(args.runId, rows)
}

main()
