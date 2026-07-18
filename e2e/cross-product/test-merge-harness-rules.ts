#!/usr/bin/env npx tsx
/**
 * Unit checks for SUPERSEDED exclusion and harness-hash merge/gate rules.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeCrossProductResults } from './merge-cross-product-results.js'
import { evaluateCrossAxisGate } from './validate-cross-axis-gate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`PASS: ${label}`)
    pass += 1
  } else {
    console.error(`FAIL: ${label}`)
    fail += 1
  }
}

function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-merge-'))
const harnessA = 'aaa111'
const harnessB = 'bbb222'
const base = {
  scenarioId: 's',
  durationMs: 1,
  commit: 'c1',
  manifest_hash: 'm1',
  applicability_rules_hash: 'r1',
  axes_hash: 'x1',
  executor_hash: 'e1',
  driver_hash: 'd1',
  oracle_hash: 'o1',
  fixture_hash: 'f1',
  cleanup_ok: true,
  route_results: [{ route_key: 'r0', delivery_outcome: 'delivered', collector_count: 1, payload_match: true }],
}

// 1) SUPERSEDED / original/ excluded
const run1 = path.join(tmp, 'run1')
writeJsonl(path.join(run1, 'xp-normal-000-ROUTE_ON/original/cross-product-results.jsonl'), [
  { ...base, combination_id: 'xp_old', status: 'PASS', harness_version: harnessA, finishedAt: '2026-01-01T00:00:00Z' },
])
fs.writeFileSync(
  path.join(run1, 'xp-normal-000-ROUTE_ON/superseded.json'),
  JSON.stringify({ status: 'SUPERSEDED', excluded_from_final_merge: true }),
)
writeJsonl(path.join(run1, 'xp-normal-001-ROUTE_ON/cross-product-results.jsonl'), [
  { ...base, combination_id: 'xp_new', status: 'PASS', harness_version: harnessA, finishedAt: '2026-01-02T00:00:00Z' },
])
const out1 = path.join(tmp, 'out1.jsonl')
const m1 = mergeCrossProductResults({ from: run1, out: out1 })
assert(m1.excluded_superseded >= 1, 'superseded/original excluded from merge')
assert(m1.written === 1, 'only non-superseded row written')
assert(fs.readFileSync(out1, 'utf-8').includes('xp_new'), 'kept rerun/new shard row')
assert(!fs.readFileSync(out1, 'utf-8').includes('xp_old'), 'excluded original shard-0 row')

// 2) Mixed harness → merge FAIL
const run2 = path.join(tmp, 'run2')
writeJsonl(path.join(run2, 'a/cross-product-results.jsonl'), [
  { ...base, combination_id: 'xp_1', status: 'PASS', harness_version: harnessA, finishedAt: '2026-01-01T00:00:00Z' },
])
writeJsonl(path.join(run2, 'b/cross-product-results.jsonl'), [
  { ...base, combination_id: 'xp_2', status: 'PASS', harness_version: harnessB, finishedAt: '2026-01-01T00:00:00Z' },
])
const m2 = mergeCrossProductResults({ from: run2, out: path.join(tmp, 'out2.jsonl') })
assert(!m2.ok, 'mixed harness versions fail merge')
assert(m2.harness_hash_mismatches >= 1, 'reports harness_hash_mismatches')

// 3) Same combination different harness → unresolved, no silent overwrite
const run3 = path.join(tmp, 'run3')
writeJsonl(path.join(run3, 'a/cross-product-results.jsonl'), [
  {
    ...base,
    combination_id: 'xp_dup',
    status: 'PASS',
    harness_version: harnessA,
    executor_hash: 'eA',
    finishedAt: '2026-01-01T00:00:00Z',
  },
])
writeJsonl(path.join(run3, 'b/cross-product-results.jsonl'), [
  {
    ...base,
    combination_id: 'xp_dup',
    status: 'FAIL',
    harness_version: harnessB,
    executor_hash: 'eB',
    finishedAt: '2026-01-02T00:00:00Z',
  },
])
const m3 = mergeCrossProductResults({ from: run3, out: path.join(tmp, 'out3.jsonl') })
assert(!m3.ok, 'conflicting harness for same combination_id fails')
assert(
  m3.unresolved.some((u) => u.combination_id === 'xp_dup'),
  'unresolved lists combination_id',
)

// 4) Gate rejects missing harness_version and SUPERSEDED rows in final file
const gateResults = path.join(tmp, 'gate-results.jsonl')
writeJsonl(gateResults, [
  { ...base, combination_id: 'xp_legacy', status: 'PASS', finishedAt: '2026-01-01T00:00:00Z' },
  {
    ...base,
    combination_id: 'xp_sup',
    status: 'SUPERSEDED',
    harness_version: harnessA,
    finishedAt: '2026-01-01T00:00:00Z',
  },
])
// Gate expects full valid set; we only assert the new error dimensions appear.
const gate = evaluateCrossAxisGate({ resultsPath: gateResults, remainingFullE2eResources: 0 })
assert(!gate.ok, 'gate fails on incomplete/legacy set')
assert(gate.superseded_included >= 1, 'gate counts SUPERSEDED in final set')
assert(gate.harness_hash_mismatches >= 1, 'gate flags missing harness_version')

console.log(`merge-harness-rules pass=${pass} fail=${fail}`)
if (fail) process.exit(1)
console.log(`tmpdir=${tmp}`)
void __dirname
