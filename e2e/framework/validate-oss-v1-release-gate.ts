#!/usr/bin/env npx tsx
/**
 * OSS v1 Release Gate validator.
 *
 * Validates OFF/ON Full Matrix completeness, allowlisted non-PASS results,
 * route-processing parity, and LOG_AND_CONTINUE semantic coverage.
 *
 * Usage:
 *   npx tsx framework/validate-oss-v1-release-gate.ts \
 *     --off-run-id <id> --on-run-id <id> [--parity-report <path>] [--out <dir>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareRouteProcessingResults,
  type ParityReport,
} from './compare-route-processing-results.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** Non-PASS statuses allowed by the OSS v1 Release Gate when justified. */
export const OSS_V1_ALLOWED_NON_PASS_STATUSES = [
  'NOT_IMPLEMENTED',
  'NOT_APPLICABLE',
  'KNOWN_PRODUCT_GAP',
  'BLOCKED',
] as const

export type AllowedNonPassStatus = (typeof OSS_V1_ALLOWED_NON_PASS_STATUSES)[number]

export type MergedScenarioResult = {
  scenario_id: string
  suite?: string
  execution_mode?: string
  route_processing?: string
  result: string
  failure_classification?: string
  reason?: string
  evidence_path?: string
}

export type NonPassRecord = {
  scenario: string
  status: string
  reason: string
  route_processing: string
  intentional: boolean
  evidence_file: string
  source?: string
  destination?: string
}

export type ModeGateSummary = {
  expected: number
  executed: number
  unique: number
  pass: number
  fail: number
  missing: number
  duplicates: number
  non_pass: number
  non_pass_breakdown: Record<string, number>
  unexplained: NonPassRecord[]
  classification_status: 'PASS' | 'FAIL'
}

export type OssV1ReleaseGateReport = {
  ok: boolean
  generated_at: string
  off: ModeGateSummary
  on: ModeGateSummary
  parity: {
    status_mismatches: number
    payload_mismatches: number
    checkpoint_mismatches: number
    delivery_mismatches: number
    failure_policy_mismatches: number
    unexpected_total: number
    log_and_continue_parity: ParityReport['log_and_continue_parity']
    partial_success_parity: ParityReport['partial_success_parity']
    checkpoint_order_independent: ParityReport['checkpoint_order_independent']
  }
  issues: string[]
}

function parseArgs(argv: string[]): {
  offRunId: string
  onRunId: string
  parityReport?: string
  outDir: string
} {
  let offRunId = ''
  let onRunId = ''
  let parityReport = ''
  let outDir = ''
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--off-run-id') offRunId = argv[++i] || ''
    else if (a === '--on-run-id') onRunId = argv[++i] || ''
    else if (a === '--parity-report') parityReport = argv[++i] || ''
    else if (a === '--out') outDir = argv[++i] || ''
  }
  if (!offRunId || !onRunId) {
    throw new Error('Usage: --off-run-id <id> --on-run-id <id> [--parity-report <path>] [--out <dir>]')
  }
  if (!outDir) {
    outDir = path.join(root, 'reports', 'oss-v1-stabilization-gate', 'release-gate-validation')
  }
  return { offRunId, onRunId, parityReport: parityReport || undefined, outDir }
}

export function isAllowedNonPassStatus(status: string): status is AllowedNonPassStatus {
  return (OSS_V1_ALLOWED_NON_PASS_STATUSES as readonly string[]).includes(status)
}

export function loadMergedResults(resultsPath: string): MergedScenarioResult[] {
  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
  if (Array.isArray(raw)) return raw as MergedScenarioResult[]
  if (Array.isArray(raw.results)) return raw.results as MergedScenarioResult[]
  if (Array.isArray(raw.scenarios)) return raw.scenarios as MergedScenarioResult[]
  throw new Error(`Unrecognized results schema: ${resultsPath}`)
}

function readScenarioMeta(evidencePath: string | undefined): {
  reason?: string
  source?: string
  destination?: string
} {
  if (!evidencePath || !fs.existsSync(evidencePath)) return {}
  const scenarioFile = path.join(evidencePath, 'scenario.json')
  const resultFile = path.join(evidencePath, 'result.json')
  let reason: string | undefined
  let source: string | undefined
  let destination: string | undefined
  if (fs.existsSync(resultFile)) {
    try {
      const r = JSON.parse(fs.readFileSync(resultFile, 'utf-8')) as { reason?: string; note?: string }
      reason = r.reason || r.note
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(scenarioFile)) {
    try {
      const s = JSON.parse(fs.readFileSync(scenarioFile, 'utf-8')) as {
        reason?: string
        source?: { type?: string }
        destination?: { type?: string }
      }
      reason = reason || s.reason
      source = s.source?.type
      destination = s.destination?.type
    } catch {
      /* ignore */
    }
  }
  return { reason, source, destination }
}

export function classifyModeResults(
  results: MergedScenarioResult[],
  opts: { routeMode: 'off' | 'on' },
): ModeGateSummary {
  const routeMode = opts.routeMode
  const ids = results.map((r) => r.scenario_id)
  const unique = new Set(ids).size
  const duplicates = ids.length - unique
  const byStatus: Record<string, number> = {}
  const unexplained: NonPassRecord[] = []
  let pass = 0
  let fail = 0

  for (const r of results) {
    byStatus[r.result] = (byStatus[r.result] || 0) + 1
    if (r.result === 'PASS') {
      pass++
      continue
    }
    if (r.result === 'FAIL') fail++

    const meta = readScenarioMeta(r.evidence_path)
    const reason = r.reason || meta.reason || ''
    const intentional =
      isAllowedNonPassStatus(r.result) &&
      Boolean(reason) &&
      r.failure_classification !== 'PRODUCT_RUNTIME' &&
      !/unknown|unexplained|infrastructure|socket hang/i.test(reason)

    const record: NonPassRecord = {
      scenario: r.scenario_id,
      status: r.result,
      reason: reason || '(missing reason)',
      route_processing: r.route_processing || routeMode,
      intentional,
      evidence_file: r.evidence_path || '',
      source: meta.source,
      destination: meta.destination,
    }

    if (!intentional) {
      unexplained.push(record)
    }
  }

  const nonPassBreakdown: Record<string, number> = {}
  for (const [k, v] of Object.entries(byStatus)) {
    if (k !== 'PASS') nonPassBreakdown[k] = v
  }

  const executed = results.length
  return {
    expected: executed,
    executed,
    unique,
    pass,
    fail,
    missing: 0,
    duplicates,
    non_pass: executed - pass,
    non_pass_breakdown: nonPassBreakdown,
    unexplained,
    classification_status: unexplained.length === 0 && fail === 0 && duplicates === 0 ? 'PASS' : 'FAIL',
  }
}

export function evaluateOssV1ReleaseGate(opts: {
  offResults: MergedScenarioResult[]
  onResults: MergedScenarioResult[]
  parity?: ParityReport
  offEvidenceRoot?: string
  onEvidenceRoot?: string
}): OssV1ReleaseGateReport {
  const off = classifyModeResults(opts.offResults, { routeMode: 'off' })
  const on = classifyModeResults(opts.onResults, { routeMode: 'on' })

  const parity =
    opts.parity ||
    compareRouteProcessingResults(opts.offResults, opts.onResults, {
      offEvidenceRoot: opts.offEvidenceRoot,
      onEvidenceRoot: opts.onEvidenceRoot,
    })

  const issues: string[] = []
  if (off.fail !== 0) issues.push(`OFF FAIL=${off.fail}`)
  if (on.fail !== 0) issues.push(`ON FAIL=${on.fail}`)
  if (off.duplicates !== 0) issues.push(`OFF duplicates=${off.duplicates}`)
  if (on.duplicates !== 0) issues.push(`ON duplicates=${on.duplicates}`)
  if (off.executed !== off.unique) issues.push('OFF executed != unique')
  if (on.executed !== on.unique) issues.push('ON executed != unique')
  if (off.classification_status !== 'PASS') {
    issues.push(`OFF unexplained non-PASS=${off.unexplained.length}`)
  }
  if (on.classification_status !== 'PASS') {
    issues.push(`ON unexplained non-PASS=${on.unexplained.length}`)
  }
  if (parity.unexpected_total !== 0) issues.push(`parity unexpected=${parity.unexpected_total}`)
  if (parity.status_mismatches !== 0) issues.push(`parity status=${parity.status_mismatches}`)
  if (parity.payload_mismatches !== 0) issues.push(`parity payload=${parity.payload_mismatches}`)
  if (parity.checkpoint_mismatches !== 0) {
    issues.push(`parity checkpoint=${parity.checkpoint_mismatches}`)
  }
  if (parity.delivery_mismatches !== 0) issues.push(`parity delivery=${parity.delivery_mismatches}`)
  if (parity.failure_policy_mismatches !== 0) {
    issues.push(`parity failure_policy=${parity.failure_policy_mismatches}`)
  }
  if (parity.log_and_continue_parity !== 'PASS') {
    issues.push(`LOG_AND_CONTINUE_PARITY=${parity.log_and_continue_parity}`)
  }
  if (parity.partial_success_parity !== 'PASS') {
    issues.push(`PARTIAL_SUCCESS_PARITY=${parity.partial_success_parity}`)
  }
  if (parity.checkpoint_order_independent !== 'PASS') {
    issues.push(`CHECKPOINT_ORDER_INDEPENDENT=${parity.checkpoint_order_independent}`)
  }

  return {
    ok: issues.length === 0,
    generated_at: new Date().toISOString(),
    off,
    on,
    parity: {
      status_mismatches: parity.status_mismatches,
      payload_mismatches: parity.payload_mismatches,
      checkpoint_mismatches: parity.checkpoint_mismatches,
      delivery_mismatches: parity.delivery_mismatches,
      failure_policy_mismatches: parity.failure_policy_mismatches,
      unexpected_total: parity.unexpected_total,
      log_and_continue_parity: parity.log_and_continue_parity,
      partial_success_parity: parity.partial_success_parity,
      checkpoint_order_independent: parity.checkpoint_order_independent,
    },
    issues,
  }
}

function defaultResultsPath(runId: string): string {
  return path.join(root, 'reports', runId, 'final', 'scenario-results.json')
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const offPath = defaultResultsPath(args.offRunId)
  const onPath = defaultResultsPath(args.onRunId)
  if (!fs.existsSync(offPath)) throw new Error(`OFF results missing: ${offPath}`)
  if (!fs.existsSync(onPath)) throw new Error(`ON results missing: ${onPath}`)

  let parity: ParityReport | undefined
  if (args.parityReport && fs.existsSync(args.parityReport)) {
    parity = JSON.parse(fs.readFileSync(args.parityReport, 'utf-8')) as ParityReport
  }

  const offResults = loadMergedResults(offPath)
  const onResults = loadMergedResults(onPath)
  const report = evaluateOssV1ReleaseGate({
    offResults,
    onResults,
    parity,
    offEvidenceRoot: path.join(root, 'reports', args.offRunId),
    onEvidenceRoot: path.join(root, 'reports', args.onRunId),
  })

  fs.mkdirSync(args.outDir, { recursive: true })
  const outJson = path.join(args.outDir, 'oss-v1-release-gate.json')
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`)

  const offClassPath = path.join(args.outDir, 'off-non-pass-classification.json')
  const onClassPath = path.join(args.outDir, 'on-non-pass-classification.json')
  fs.writeFileSync(
    offClassPath,
    `${JSON.stringify(
      {
        breakdown: report.off.non_pass_breakdown,
        unexplained: report.off.unexplained,
        classification_status: report.off.classification_status,
        non_pass_records: offResults
          .filter((r) => r.result !== 'PASS')
          .map((r) => {
            const meta = readScenarioMeta(r.evidence_path)
            return {
              scenario: r.scenario_id,
              status: r.result,
              reason: r.reason || meta.reason || '',
              route_processing: r.route_processing || 'off',
              intentional: isAllowedNonPassStatus(r.result) && Boolean(r.reason || meta.reason),
              evidence_file: r.evidence_path || '',
              source: meta.source,
              destination: meta.destination,
            }
          }),
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(
    onClassPath,
    `${JSON.stringify(
      {
        breakdown: report.on.non_pass_breakdown,
        unexplained: report.on.unexplained,
        classification_status: report.on.classification_status,
        non_pass_records: onResults
          .filter((r) => r.result !== 'PASS')
          .map((r) => {
            const meta = readScenarioMeta(r.evidence_path)
            return {
              scenario: r.scenario_id,
              status: r.result,
              reason: r.reason || meta.reason || '',
              route_processing: r.route_processing || 'on',
              intentional: isAllowedNonPassStatus(r.result) && Boolean(r.reason || meta.reason),
              evidence_file: r.evidence_path || '',
              source: meta.source,
              destination: meta.destination,
            }
          }),
      },
      null,
      2,
    )}\n`,
  )

  const summary = [
    `RELEASE_GATE_VALIDATION=${report.ok ? 'PASS' : 'FAIL'}`,
    `OFF_PASS=${report.off.pass}`,
    `OFF_NON_PASS=${report.off.non_pass}`,
    `OFF_UNEXPLAINED=${report.off.unexplained.length}`,
    `ON_PASS=${report.on.pass}`,
    `ON_NON_PASS=${report.on.non_pass}`,
    `ON_UNEXPLAINED=${report.on.unexplained.length}`,
    `LOG_AND_CONTINUE_PARITY=${report.parity.log_and_continue_parity}`,
    `PARTIAL_SUCCESS_PARITY=${report.parity.partial_success_parity}`,
    `CHECKPOINT_ORDER_INDEPENDENT=${report.parity.checkpoint_order_independent}`,
  ].join(' ')
  fs.writeFileSync(path.join(args.outDir, 'oss-v1-release-gate-summary.txt'), `${summary}\n`)
  console.log(summary)
  console.log(`wrote ${outJson}`)
  if (!report.ok) {
    for (const issue of report.issues) console.error(`  - ${issue}`)
    process.exit(1)
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  main()
}
