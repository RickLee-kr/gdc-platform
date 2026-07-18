#!/usr/bin/env npx tsx
/**
 * Cross-Axis Coverage Gate.
 * Capability-once coverage is NOT sufficient — every valid combination_id must execute.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOT_IMPLEMENTED_SCENARIO_IDS } from './applicability-rules.js'
import type {
  CrossAxisGateResult,
  CrossProductRunResult,
  GenerationSummary,
  NotApplicableCombination,
  ValidCombination,
} from './cross-product-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEN = path.join(__dirname, 'generated')
const NI_BASELINE = path.resolve(__dirname, '../release-gate/baseline/not-implemented-baseline.json')

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)
}

export function evaluateCrossAxisGate(opts: {
  resultsPath: string
  remainingFullE2eResources?: number
}): CrossAxisGateResult {
  const summary = JSON.parse(
    fs.readFileSync(path.join(GEN, 'generation-summary.json'), 'utf-8'),
  ) as GenerationSummary
  const valid = readJsonl<ValidCombination>(path.join(GEN, 'valid-combinations.jsonl'))
  const na = readJsonl<NotApplicableCombination>(path.join(GEN, 'not-applicable.jsonl'))
  const results = readJsonl<CrossProductRunResult>(opts.resultsPath)

  const errors: string[] = []
  const warnings: string[] = []

  const expectedIds = new Set(valid.map((v) => v.combination_id))
  const executed = new Map<string, CrossProductRunResult[]>()
  let superseded_included = 0
  let harness_hash_mismatches = 0
  let runtime_collector_mismatches = 0
  const harnessVersions = new Set<string>()
  for (const r of results) {
    if (r.status === 'SUPERSEDED' || r.result_status === 'SUPERSEDED') {
      superseded_included += 1
      continue
    }
    const list = executed.get(r.combination_id) || []
    list.push(r)
    executed.set(r.combination_id, list)
    if (r.harness_version) harnessVersions.add(r.harness_version)
    if ((r.runtime_collector_mismatch || 0) > 0) runtime_collector_mismatches += 1
  }
  if (harnessVersions.size > 1) harness_hash_mismatches = harnessVersions.size
  // Final results must carry harness_version (legacy / old-harness rows are untrusted).
  const missingHarness = [...executed.values()]
    .flat()
    .filter((r) => !r.harness_version).length
  if (missingHarness) {
    harness_hash_mismatches = Math.max(harness_hash_mismatches, missingHarness)
  }

  const missing_combination_ids: string[] = []
  for (const id of expectedIds) {
    if (!executed.has(id)) missing_combination_ids.push(id)
  }

  const duplicate_combination_ids: string[] = []
  for (const [id, list] of executed) {
    if (list.length > 1) duplicate_combination_ids.push(id)
  }

  const results_without_combination: string[] = []
  for (const id of executed.keys()) {
    if (!expectedIds.has(id)) results_without_combination.push(id)
  }

  let unjustified = 0
  for (const row of na) {
    if (!row.rule_id || !row.reason || !row.evidence) unjustified += 1
  }

  // Browser-supported combinations must have browser execution when surface=BROWSER
  const browserExpected = valid.filter((v) => v.axes.execution_surface === 'BROWSER')
  let browser_missing = 0
  for (const row of browserExpected) {
    const runs = executed.get(row.combination_id)
    if (!runs?.length) browser_missing += 1
  }

  let route_evidence_missing = 0
  let collector_evidence_missing = 0
  let cleanup_failures = 0
  let fail = 0
  let blocked = 0
  let gap = 0

  for (const r of results) {
    if (r.status === 'SUPERSEDED' || r.result_status === 'SUPERSEDED') continue
    if (r.status === 'FAIL') fail += 1
    if (r.status === 'BLOCKED') blocked += 1
    if (r.status === 'GAP') gap += 1
    if (!r.route_results?.length) route_evidence_missing += 1
    if (r.route_results && !r.route_results.every((x) => typeof x.collector_count === 'number')) {
      collector_evidence_missing += 1
    }
    if (r.cleanup_ok === false) cleanup_failures += 1
  }

  const niBaseline = JSON.parse(fs.readFileSync(NI_BASELINE, 'utf-8')) as { scenario_ids: string[] }
  const not_implemented_unchanged =
    [...NOT_IMPLEMENTED_SCENARIO_IDS].sort().join('\n') ===
    [...niBaseline.scenario_ids].sort().join('\n')

  if (missing_combination_ids.length) errors.push(`missing executed combinations: ${missing_combination_ids.length}`)
  if (duplicate_combination_ids.length) errors.push(`duplicate combination results: ${duplicate_combination_ids.length}`)
  if (results_without_combination.length) {
    errors.push(`results without expected combination: ${results_without_combination.length}`)
  }
  if (unjustified) errors.push(`unjustified NOT_APPLICABLE: ${unjustified}`)
  if (browser_missing) errors.push(`browser combinations not executed: ${browser_missing}`)
  if (route_evidence_missing) errors.push(`route evidence missing: ${route_evidence_missing}`)
  if (collector_evidence_missing) errors.push(`collector evidence missing: ${collector_evidence_missing}`)
  if (cleanup_failures) errors.push(`cleanup failures: ${cleanup_failures}`)
  if (fail) errors.push(`FAIL: ${fail}`)
  if (blocked) errors.push(`BLOCKED: ${blocked}`)
  if (gap) errors.push(`GAP: ${gap}`)
  if (superseded_included) errors.push(`SUPERSEDED results included in final set: ${superseded_included}`)
  if (harness_hash_mismatches) {
    errors.push(`harness hash mismatches / mixed or missing harness_version: ${harness_hash_mismatches}`)
  }
  if (runtime_collector_mismatches) {
    errors.push(`Runtime↔Collector mismatch rows: ${runtime_collector_mismatches}`)
  }
  if ((opts.remainingFullE2eResources ?? 0) !== 0) {
    errors.push(`FULL E2E remaining resources: ${opts.remainingFullE2eResources}`)
  }
  if (!not_implemented_unchanged) errors.push('NOT_IMPLEMENTED set changed')
  if (summary.valid_combinations !== valid.length) {
    errors.push('generation summary valid count != jsonl rows')
  }

  const result: CrossAxisGateResult = {
    ok: errors.length === 0,
    errors,
    warnings,
    expected_valid: expectedIds.size,
    executed: executed.size,
    missing_combination_ids: missing_combination_ids.slice(0, 50),
    duplicate_combination_ids: duplicate_combination_ids.slice(0, 50),
    results_without_combination: results_without_combination.slice(0, 50),
    unjustified_not_applicable: unjustified,
    browser_missing,
    route_evidence_missing,
    collector_evidence_missing,
    cleanup_failures,
    remaining_full_e2e_resources: opts.remainingFullE2eResources ?? 0,
    not_implemented_unchanged,
    fail,
    blocked,
    gap,
    missing: missing_combination_ids.length,
    harness_hash_mismatches,
    superseded_included,
    runtime_collector_mismatches,
  }

  return result
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('validate-cross-axis-gate.ts'))

if (isMain) {
  const resultsPath =
    process.argv.find((a) => a.startsWith('--results='))?.slice('--results='.length) ||
    process.env.GDC_XP_RESULTS ||
    path.join(__dirname, '../reports/cross-product-local/cross-product-results.jsonl')
  const remaining = Number(
    process.argv.find((a) => a.startsWith('--remaining='))?.slice('--remaining='.length) || '0',
  )
  const gate = evaluateCrossAxisGate({ resultsPath, remainingFullE2eResources: remaining })
  const outDir = path.dirname(resultsPath)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'cross-axis-gate.json'), `${JSON.stringify(gate, null, 2)}\n`)
  console.log(JSON.stringify({ ok: gate.ok, errors: gate.errors, missing: gate.missing, fail: gate.fail }, null, 2))
  if (!gate.ok) process.exitCode = 1
}
