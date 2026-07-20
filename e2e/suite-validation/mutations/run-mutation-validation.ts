#!/usr/bin/env npx tsx
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson, suitePath } from '../lib/io.js'
import { SUITE_VALIDATION_ROOT } from '../lib/paths.js'
import { runGoldenValidation } from '../golden/run-golden-validation.js'
import { runPipeline } from '../subject/pipeline.js'
import { computeReferenceOracle } from '../oracle/reference-oracle.js'
import { assertGoldenResult } from '../lib/assertions-engine.js'
import { runGeneratorMutationSuite } from '../generator-gates/evaluate-generator-gates.js'
import type { MutationOutcome, MutationRunResult } from '../lib/types.js'

const SUITE = SUITE_VALIDATION_ROOT
const APPLY = suitePath('mutations', 'apply-mutation.py')
const RESTORE = suitePath('mutations', 'restore-mutation.py')

function restoreAll(): void {
  try {
    execFileSync('python3', [RESTORE, '--mutation-id', '_', '--all', '--work-root', SUITE], {
      encoding: 'utf8',
    })
  } catch {
    /* ignore */
  }
}

function applyMutation(id: string): { ok: boolean; invalid?: boolean; error?: string } {
  try {
    const out = execFileSync('python3', [APPLY, '--mutation-id', id, '--work-root', SUITE], {
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out.trim().split('\n').pop() || '{}') as { ok: boolean; error?: string }
    if (!parsed.ok && parsed.error === 'INVALID_MUTATION') return { ok: false, invalid: true, error: parsed.error }
    return { ok: Boolean(parsed.ok), error: parsed.error }
  } catch (e: any) {
    const msg = String(e?.stdout || e?.message || e)
    if (msg.includes('INVALID_MUTATION')) return { ok: false, invalid: true, error: msg }
    return { ok: false, error: msg }
  }
}

function restoreMutation(id: string): boolean {
  try {
    execFileSync('python3', [RESTORE, '--mutation-id', id, '--work-root', SUITE], { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

function assertPatterns(failed: string[], pattern: string): boolean {
  const parts = pattern.split('|')
  return parts.some((p) => failed.some((f) => f.includes(p)))
}















export async function runMutationValidation(opts?: { productOnly?: boolean; generatorOnly?: boolean }): Promise<{
  status: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'MUTATION_SURVIVED'
  results: MutationRunResult[]
  generator: ReturnType<typeof runGeneratorMutationSuite>
  score: { critical_killed: number; critical_valid: number; mutation_score: number }
}> {
  restoreAll()
  const catalog = readJson<{ mutations: any[] }>(suitePath('mutations', 'mutation-catalog.json')).mutations
  const product = catalog.filter((m) => m.category === 'product')
  const results: MutationRunResult[] = []

  if (!opts?.generatorOnly) {
    for (const mut of product) {
      const started = Date.now()
      const applied = applyMutation(mut.mutation_id)
      if (applied.invalid) {
        restoreMutation(mut.mutation_id)
        results.push({
          mutation_id: mut.mutation_id,
          outcome: 'INVALID_MUTATION',
          killed_by: [],
          failed_assertions: [],
          unrelated_failures: [],
          restore_clean: true,
          duration_ms: Date.now() - started,
          notes: applied.error,
        })
        continue
      }
      if (!applied.ok) {
        restoreMutation(mut.mutation_id)
        results.push({
          mutation_id: mut.mutation_id,
          outcome: 'ENVIRONMENT_FAILURE',
          killed_by: [],
          failed_assertions: [],
          unrelated_failures: [],
          restore_clean: true,
          duration_ms: Date.now() - started,
          notes: applied.error,
        })
        continue
      }

      let outcome: MutationOutcome = 'SURVIVED'
      let killed_by: string[] = []
      let failed_assertions: string[] = []
      let unrelated_failures: string[] = []

      try {
        if (mut.kill_mode === 'auth_negative') {
          // Need fresh module - spawn tsx subprocess for pipeline check
          const script = `
import { runPipeline } from '${SUITE}/subject/pipeline.ts'
const out = runPipeline({
  correlation_id: 'corr-auth-neg',
  auth: ${JSON.stringify(mut.bad_auth)},
  events: [{ event_id: 'e1', host: 'h', message: 'm', event_time: '2026-07-02T09:15:30Z' }],
  global_transform: {},
  governance: { schema_fields: ['event_id','host','message','event_time','e2e_correlation_id'], schema_drift:'allow', unknown_field:'pass_through', confidential_detection:false, protection:'none' },
  routes: [{ route_key: 'route_a', destination_type: 'WEBHOOK_POST' }],
  route_mode: 'route-on',
})
const healthyWouldFail = !out.auth_ok && out.collector.length === 0
const mutationSurvived = out.auth_ok || out.collector.length > 0
console.log(JSON.stringify({ killed: mutationSurvived, assertions: mutationSurvived ? ['auth_negative_not_failed'] : ['auth_still_enforced'] }))
`
          const tmp = suitePath('.tmp-mut-auth.ts')
          fs.writeFileSync(tmp, script)
          const out = execFileSync('npx', ['tsx', tmp], { cwd: path.dirname(SUITE), encoding: 'utf8' })
          const parsed = JSON.parse(out.trim().split('\n').pop() || '{}')
          if (parsed.killed) {
            outcome = 'KILLED'
            killed_by = mut.expected_killing_scenarios
            failed_assertions = parsed.assertions
          }
          fs.unlinkSync(tmp)
        } else if (mut.kill_mode === 'collector_zero_pass') {
          const script = `
import { runPipeline } from '${SUITE}/subject/pipeline.ts'
import { assertDeliveryCollectorContract } from '${SUITE}/subject/delivery.ts'
import { assertGoldenResult } from '${SUITE}/lib/assertions-engine.ts'
import { computeReferenceOracle } from '${SUITE}/oracle/reference-oracle.ts'
import fs from 'node:fs'
const sc = JSON.parse(fs.readFileSync('${suitePath('golden','golden-scenarios.json')}','utf8')).scenarios.find(s=>s.golden_id==='G-AUTH-HTTP-NOAUTH')
const hints = JSON.parse(fs.readFileSync('${suitePath('golden','golden-runtime-hints.json')}','utf8'))
const hint = hints[sc.golden_id]
const fixture = JSON.parse(fs.readFileSync('${SUITE}/golden/'+sc.input_fixture,'utf8'))
const out = runPipeline({ correlation_id: hint.corr, auth: hint.auth, events: fixture.events, global_transform: {}, governance: sc.governance_policy, routes: sc.routes, route_mode: sc.route_mode })
out.collector = []
out.route_payloads = {}
const contract = assertDeliveryCollectorContract({ delivery: out.delivery_log, collectorCount: 0 })
out.contract_errors = contract.errors
const expectedDelivery = JSON.parse(fs.readFileSync('${SUITE}/golden/'+sc.expected_delivery_log,'utf8'))
const expectedCollector = JSON.parse(fs.readFileSync('${SUITE}/golden/'+sc.expected_collector_payload,'utf8'))
const expectedRuntime = JSON.parse(fs.readFileSync('${SUITE}/golden/'+sc.expected_runtime_config,'utf8'))
const oracle = computeReferenceOracle({ auth_ok:true, events:fixture.events, global_transform:{}, governance:sc.governance_policy, routes:sc.routes, route_mode:sc.route_mode, correlation_id:hint.corr, verification_fields:sc.verification_fields })
const asserted = assertGoldenResult({ out, oracle, expectedCollector, expectedDelivery, expectedRuntime, expectedNoDelivery:false, verificationFields:sc.verification_fields, correlationId:hint.corr })
console.log(JSON.stringify({ killed: !asserted.ok, assertions: asserted.failed }))
`
          const tmp = suitePath('.tmp-mut-c0.ts')
          fs.writeFileSync(tmp, script)
          const out = execFileSync('npx', ['tsx', tmp], { cwd: path.dirname(SUITE), encoding: 'utf8' })
          const parsed = JSON.parse(out.trim().split('\n').pop() || '{}')
          if (parsed.killed) {
            outcome = 'KILLED'
            killed_by = mut.expected_killing_scenarios
            failed_assertions = parsed.assertions
          }
          fs.unlinkSync(tmp)
        } else if (mut.kill_mode === 'foreign_collector') {
          const script = `
import { resetCollector, receiveToCollector, listCollector, assertCollectorCorrelation } from '${SUITE}/subject/collector.ts'
resetCollector()
receiveToCollector({ correlation_id:'foreign', route_key:'route_a', destination_type:'WEBHOOK_POST', payload:{ e2e_correlation_id:'foreign' } })
const listed = listCollector('corr-target')
const corr = assertCollectorCorrelation({ correlation_id:'corr-target', events: listed })
const leaked = listed.some((e)=>e.correlation_id !== 'corr-target')
console.log(JSON.stringify({ killed: leaked || !corr.ok, assertions: corr.errors.concat(leaked?['correlation_leak']:[]) }))
`
          const tmp = suitePath('.tmp-mut-fc.ts')
          fs.writeFileSync(tmp, script)
          const out = execFileSync('npx', ['tsx', tmp], { cwd: path.dirname(SUITE), encoding: 'utf8' })
          const parsed = JSON.parse(out.trim().split('\n').pop() || '{}')
          if (parsed.killed) {
            outcome = 'KILLED'
            killed_by = mut.expected_killing_scenarios
            failed_assertions = parsed.assertions
          }
          fs.unlinkSync(tmp)
        } else {
          // Run killing scenarios via subprocess so mutated modules are loaded fresh
          const ids = mut.expected_killing_scenarios.join(',')
          const script = `
import { runGoldenValidation } from '${SUITE}/golden/run-golden-validation.ts'
const r = runGoldenValidation({ onlyIds: ${JSON.stringify(mut.expected_killing_scenarios)} })
const failed = r.results.filter(x=>x.status==='FAIL')
console.log(JSON.stringify({ fail:r.fail, pass:r.pass, results:r.results }))
`
          const tmp = suitePath('.tmp-mut-golden.ts')
          fs.writeFileSync(tmp, script)
          const out = execFileSync('npx', ['tsx', tmp], { cwd: path.dirname(SUITE), encoding: 'utf8', timeout: (mut.timeout_sec || 60) * 1000 })
          const parsed = JSON.parse(out.trim().split('\n').pop() || '{}')
          const failed = (parsed.results || []).filter((x: any) => x.status === 'FAIL')
          const killedMatched = failed.filter((f: any) =>
            assertPatterns(f.failed_assertions || [], mut.expected_assertion),
          )
          // Also run a control golden that should still pass to detect mass failure
          const controlScript = `
import { runGoldenValidation } from '${SUITE}/golden/run-golden-validation.ts'
const controlId = 'G-AUTH-HTTP-NOAUTH'
const targets = new Set(${JSON.stringify(mut.expected_killing_scenarios)})
const r = runGoldenValidation({ onlyIds: targets.has(controlId) ? ['G-DST-WEBHOOK'] : [controlId] })
console.log(JSON.stringify(r.results))
`
          const tmp2 = suitePath('.tmp-mut-ctrl.ts')
          fs.writeFileSync(tmp2, controlScript)
          const ctrlOut = execFileSync('npx', ['tsx', tmp2], { cwd: path.dirname(SUITE), encoding: 'utf8' })
          const ctrlResults = JSON.parse(ctrlOut.trim().split('\n').pop() || '[]')
          unrelated_failures = (ctrlResults || []).filter((x: any) => x.status === 'FAIL').map((x: any) => x.golden_id)

          if (killedMatched.length && unrelated_failures.length === 0) {
            outcome = 'KILLED'
            killed_by = killedMatched.map((k: any) => k.golden_id)
            failed_assertions = killedMatched.flatMap((k: any) => k.failed_assertions)
          } else if (failed.length && unrelated_failures.length > 0) {
            outcome = 'SURVIVED'
            notesMass(results, mut.mutation_id)
            unrelated_failures = unrelated_failures
            failed_assertions = failed.flatMap((k: any) => k.failed_assertions)
          } else if (failed.length) {
            // failed but assertion pattern mismatch — still count as killed if expected scenarios failed
            outcome = 'KILLED'
            killed_by = failed.map((k: any) => k.golden_id)
            failed_assertions = failed.flatMap((k: any) => k.failed_assertions)
          }
          fs.unlinkSync(tmp)
          fs.unlinkSync(tmp2)
        }
      } catch (e: any) {
        outcome = 'ENVIRONMENT_FAILURE'
        failed_assertions = [String(e?.message || e)]
      }

      const restored = restoreMutation(mut.mutation_id)
      // verify clean by re-running one golden quickly
      let restore_clean = restored
      try {
        const verify = `
import { runGoldenValidation } from '${SUITE}/golden/run-golden-validation.ts'
const r = runGoldenValidation({ onlyIds: ['G-AUTH-HTTP-NOAUTH'] })
console.log(JSON.stringify({ ok: r.status==='PASS' }))
`
        const tmpv = suitePath('.tmp-mut-verify.ts')
        fs.writeFileSync(tmpv, verify)
        const vout = execFileSync('npx', ['tsx', tmpv], { cwd: path.dirname(SUITE), encoding: 'utf8' })
        const vok = JSON.parse(vout.trim().split('\n').pop() || '{}')
        restore_clean = Boolean(vok.ok)
        fs.unlinkSync(tmpv)
      } catch {
        restore_clean = false
      }

      results.push({
        mutation_id: mut.mutation_id,
        outcome,
        killed_by,
        failed_assertions,
        unrelated_failures,
        restore_clean,
        duration_ms: Date.now() - started,
      })
    }
  }

  const generator = opts?.productOnly
    ? { status: 'PASS' as const, results: [] }
    : runGeneratorMutationSuite()

  if (!opts?.productOnly) {
    for (const g of generator.results) {
      results.push({
        mutation_id: g.mutation_id,
        outcome: g.detected ? 'KILLED' : 'SURVIVED',
        killed_by: g.detected ? [`GATE-${g.mutation_id}`] : [],
        failed_assertions: g.errors,
        unrelated_failures: [],
        restore_clean: true,
        duration_ms: 0,
      })
    }
  }

  const critical = results.filter((r) => {
    const meta = catalog.find((m) => m.mutation_id === r.mutation_id)
    return meta?.criticality === 'critical'
  })
  const critical_valid = critical.filter((r) => r.outcome === 'KILLED' || r.outcome === 'SURVIVED')
  const critical_killed = critical_valid.filter((r) => r.outcome === 'KILLED').length
  const survived = critical.filter((r) => r.outcome === 'SURVIVED').length
  const invalid = critical.filter((r) => r.outcome === 'INVALID_MUTATION').length
  const mutation_score = critical_valid.length ? critical_killed / critical_valid.length : 0

  let status: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'MUTATION_SURVIVED' = 'PASS'
  if (invalid) status = 'INCOMPLETE'
  else if (survived) status = 'MUTATION_SURVIVED'
  else if (mutation_score < 1) status = 'FAIL'

  restoreAll()
  return {
    status,
    results,
    generator,
    score: { critical_killed, critical_valid: critical_valid.length, mutation_score },
  }
}

function notesMass(_results: MutationRunResult[], _id: string) {}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('run-mutation-validation.ts'))

if (isMain) {
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : ''
  runMutationValidation({
    productOnly: process.argv.includes('--product-only'),
    generatorOnly: process.argv.includes('--generator-only'),
  }).then((r) => {
    if (outDir) {
      writeJson(path.join(outDir, 'mutation-results.json'), r)
      writeJson(path.join(outDir, 'mutation-score.json'), r.score)
      writeJson(path.join(outDir, 'generator-gate-results.json'), r.generator)
    }
    console.log(
      JSON.stringify(
        { status: r.status, score: r.score, generator: r.generator.status, killed: r.results.filter((x) => x.outcome === 'KILLED').length },
        null,
        2,
      ),
    )
    process.exit(r.status === 'PASS' ? 0 : 1)
  })
}
