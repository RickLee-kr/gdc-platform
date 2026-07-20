#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { makeRunId, defaultReportsRoot, ensureReportDir, REPO_ROOT, OWNERSHIP, SUITE_VALIDATION_ROOT } from './lib/paths.js'
import { writeJson } from './lib/io.js'
import { verifyRecoveryArtifactsUnchanged } from './lib/recovery-integrity.js'
import { validateOracleIndependence } from './oracle/validate-oracle-independence.js'
import { validateGoldenCoverage } from './golden/validate-golden-coverage.js'
import { validateCapabilityIdCoverage } from './golden/validate-capability-id-coverage.js'
import { runGoldenValidation } from './golden/run-golden-validation.js'
import { runNegativeControls } from './negative/run-negative-controls.js'
import { runMutationValidation } from './mutations/run-mutation-validation.js'
import { validateRealPathCoverage } from './trace/validate-real-path-coverage.js'
import { runRetryPolicyNegatives } from './retry/run-retry-policy-negatives.js'
import { computeHarnessVersion, clearHarnessVersionCache } from '../cross-product/harness-version.js'
import type { FinalVerdict, GateStatus, ResumeReadiness } from './lib/types.js'

export type CliOptions = {
  goldenOnly?: boolean
  negativeOnly?: boolean
  mutationOnly?: boolean
  generatorMutationOnly?: boolean
  realPathOnly?: boolean
  full?: boolean
  reportsRoot?: string
  runId?: string
  dryRun?: boolean
  skipLegacySubjectMutations?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--golden-only') opts.goldenOnly = true
    else if (a === '--negative-only') opts.negativeOnly = true
    else if (a === '--mutation-only') opts.mutationOnly = true
    else if (a === '--generator-mutation-only') opts.generatorMutationOnly = true
    else if (a === '--real-path-only') opts.realPathOnly = true
    else if (a === '--full') opts.full = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--skip-legacy-subject-mutations') opts.skipLegacySubjectMutations = true
    else if (a === '--reports-root') opts.reportsRoot = argv[++i]
    else if (a === '--run-id') opts.runId = argv[++i]
  }
  if (
    !opts.goldenOnly &&
    !opts.negativeOnly &&
    !opts.mutationOnly &&
    !opts.generatorMutationOnly &&
    !opts.realPathOnly
  ) {
    opts.full = true
  }
  return opts
}

function worktreeDirty(): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
    const lines = out.split('\n').filter(Boolean)
    return lines.some((l) => l.includes('.mutation-backup') || l.includes('.tmp-mut-') || l.includes('real-path/.mutation-backup'))
  } catch {
    return false
  }
}

function runRealPathMutations(reportDir: string): Record<string, unknown> {
  const script = path.join(SUITE_VALIDATION_ROOT, 'real-path', 'run-real-path-mutations.py')
  execFileSync('python3', [script, '--report-dir', reportDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60 * 1000,
  })
  const scorePath = path.join(reportDir, 'real-path-mutation-score.json')
  const resultsPath = path.join(reportDir, 'real-path-mutation-results.json')
  return {
    score: JSON.parse(fs.readFileSync(scorePath, 'utf8')),
    results: JSON.parse(fs.readFileSync(resultsPath, 'utf8')),
  }
}

function runMutationAudit(reportDir: string): Record<string, unknown> {
  const script = path.join(SUITE_VALIDATION_ROOT, 'audit', 'build-mutation-audit.py')
  // audit already generated as json; copy into report
  const src = path.join(SUITE_VALIDATION_ROOT, 'audit', 'mutation-audit.json')
  if (!fs.existsSync(src)) {
    execFileSync('python3', ['-c', `
from pathlib import Path
import json, runpy
# regenerate via existing file
print('missing')
`], { encoding: 'utf8' })
  }
  const audit = JSON.parse(fs.readFileSync(src, 'utf8'))
  writeJson(path.join(reportDir, 'mutation-audit.json'), audit)
  fs.copyFileSync(
    path.join(SUITE_VALIDATION_ROOT, 'audit', 'mutation-audit.md'),
    path.join(reportDir, 'mutation-audit.md'),
  )
  return audit
}

export async function runSuiteValidationGate(cli: CliOptions = {}): Promise<{
  status: GateStatus
  verdict: FinalVerdict
  resume_readiness: ResumeReadiness
  reportDir: string
  incomplete_reason?: string
}> {
  const reportsRoot = cli.reportsRoot || defaultReportsRoot()
  const runId = cli.runId || makeRunId()
  const reportDir = ensureReportDir(reportsRoot, runId)
  const gates: Record<string, unknown> = {}
  let incomplete_reason: string | undefined

  if (cli.dryRun) {
    const summary = {
      run_id: runId,
      ownership: OWNERSHIP,
      status: 'INCOMPLETE' as GateStatus,
      verdict: 'E2E_SUITE_INCOMPLETE' as FinalVerdict,
      resume_readiness: 'HOLD' as ResumeReadiness,
      incomplete_reason: 'REAL_PATH_MUTATION_PROOF_REQUIRED',
      dry_run: true,
      gates: {},
    }
    writeJson(path.join(reportDir, 'suite-validation-summary.json'), summary)
    return { status: summary.status, verdict: summary.verdict, resume_readiness: summary.resume_readiness, reportDir, incomplete_reason: summary.incomplete_reason }
  }

  // 0) Mutation audit (legacy subject classification)
  if (cli.full || cli.realPathOnly || cli.mutationOnly) {
    gates.mutation_audit = runMutationAudit(reportDir)
  }

  // 1) Oracle independence
  if (cli.full || cli.goldenOnly || (!cli.negativeOnly && !cli.mutationOnly && !cli.generatorMutationOnly && !cli.realPathOnly)) {
    const oracle = validateOracleIndependence()
    writeJson(path.join(reportDir, 'oracle-independence.json'), oracle)
    gates.oracle = oracle
    if (oracle.status !== 'PASS') {
      return finalize(reportDir, runId, 'ORACLE_NOT_INDEPENDENT', gates)
    }
  }

  // 2) Capability ID direct mapping
  if (cli.full || cli.goldenOnly || cli.realPathOnly) {
    const capMap = validateCapabilityIdCoverage()
    writeJson(path.join(reportDir, 'capability-id-coverage.json'), capMap)
    gates.capability_id_coverage = capMap
    if (capMap.status !== 'PASS') {
      incomplete_reason = 'CAPABILITY_MAPPING_MISSING'
      return finalize(reportDir, runId, 'INCOMPLETE', gates, incomplete_reason)
    }
  }

  // 3) Golden coverage (legacy purpose substrings kept as secondary) + execution
  if (cli.full || cli.goldenOnly) {
    const coverage = validateGoldenCoverage()
    gates.golden_coverage_legacy_purpose = coverage
    const golden = runGoldenValidation()
    writeJson(path.join(reportDir, 'golden-results.json'), golden)
    gates.golden = golden
    if (coverage.status !== 'PASS' || golden.status !== 'PASS') {
      return finalize(reportDir, runId, 'FAIL', gates)
    }
  }

  // 4) Negative controls
  if (cli.full || cli.negativeOnly) {
    const neg = runNegativeControls()
    writeJson(path.join(reportDir, 'negative-control-results.json'), neg)
    gates.negative = neg
    if (neg.status === 'FALSE_PASS_DETECTED') return finalize(reportDir, runId, 'FALSE_PASS_DETECTED', gates)
    if (neg.status !== 'PASS') return finalize(reportDir, runId, 'FAIL', gates)
  }

  // 5) Legacy subject mutations — recorded separately, NOT mixed into real-path score
  if ((cli.full || cli.mutationOnly || cli.generatorMutationOnly) && !cli.skipLegacySubjectMutations && !cli.realPathOnly) {
    const mut = await runMutationValidation({
      productOnly: Boolean(cli.mutationOnly && !cli.full && !cli.generatorMutationOnly),
      generatorOnly: Boolean(cli.generatorMutationOnly),
    })
    writeJson(path.join(reportDir, 'mutation-results.json'), mut)
    writeJson(path.join(reportDir, 'mutation-score.json'), mut.score)
    writeJson(path.join(reportDir, 'generator-gate-results.json'), mut.generator)
    gates.legacy_subject_validation = {
      status: mut.status,
      score: mut.score,
      note: 'subject/* mutations only — excluded from real-path trust score',
    }
    gates.generator = mut.generator
    if (mut.status === 'MUTATION_SURVIVED') {
      // legacy failure does not grant trust, but still report
    }
  }

  // 6) Real-path mutations (REQUIRED for TRUSTED)
  if (cli.full || cli.realPathOnly || cli.mutationOnly) {
    try {
      const rp = runRealPathMutations(reportDir)
      gates.real_path_mutation = rp
      const score = rp.score as Record<string, number>
      const coverage = validateRealPathCoverage(reportDir)
      writeJson(path.join(reportDir, 'real-path-trace-coverage.json'), coverage)
      gates.real_path_trace_coverage = coverage

      const productOk = score.product_real_path_score === 1
      const harnessOk = score.harness_real_path_score === 1
      const noSubject = score.subject_only_mutations === 0
      const noTne = score.target_not_executed === 0
      const noSurvived = score.survived === 0
      const noMass = score.mass_failures === 0
      const noRestore = score.restore_failures === 0

      if (!productOk || !harnessOk || !noSubject || !noTne || !noSurvived || !noMass || !noRestore || coverage.status !== 'PASS') {
        if (score.survived > 0) {
          return finalize(reportDir, runId, 'MUTATION_SURVIVED', gates, 'REAL_PATH_MUTATION_SURVIVED')
        }
        if (score.target_not_executed > 0 || coverage.target_not_executed?.length) {
          return finalize(reportDir, runId, 'INCOMPLETE', gates, 'TARGET_NOT_EXECUTED')
        }
        return finalize(reportDir, runId, 'INCOMPLETE', gates, 'REAL_PATH_MUTATION_PROOF_REQUIRED')
      }
    } catch (e: any) {
      gates.real_path_mutation = { status: 'ENVIRONMENT_FAILURE', error: String(e?.stderr || e?.message || e) }
      return finalize(reportDir, runId, 'INCOMPLETE', gates, 'REAL_PATH_MUTATION_PROOF_REQUIRED')
    }
  }

  // 7) Retry policy negatives (lab stability must not hide product FAIL)
  if (cli.full || cli.negativeOnly) {
    const retryNeg = runRetryPolicyNegatives()
    writeJson(path.join(reportDir, 'retry-policy-negatives.json'), retryNeg)
    gates.retry_policy_negatives = retryNeg
    if (!retryNeg.ok) return finalize(reportDir, runId, 'FAIL', gates, 'RETRY_POLICY')
  }

  // 8) Recovery integrity
  const recovery = verifyRecoveryArtifactsUnchanged()
  writeJson(path.join(reportDir, 'recovery-integrity.json'), recovery)
  gates.recovery_integrity = recovery
  if (recovery.status !== 'PASS') return finalize(reportDir, runId, 'FAIL', gates)

  // 9) Dirty mutation leftovers
  if (worktreeDirty()) return finalize(reportDir, runId, 'DIRTY_WORKTREE', gates)

  return finalize(reportDir, runId, 'PASS', gates)
}

function finalize(
  reportDir: string,
  runId: string,
  status: GateStatus,
  gates: Record<string, unknown>,
  incomplete_reason?: string,
): { status: GateStatus; verdict: FinalVerdict; resume_readiness: ResumeReadiness; reportDir: string; incomplete_reason?: string } {
  let verdict: FinalVerdict = 'E2E_SUITE_INCOMPLETE'
  let resume_readiness: ResumeReadiness = 'HOLD'
  let reason = incomplete_reason

  const rp = gates.real_path_mutation as { score?: Record<string, number> } | undefined
  const score = rp?.score
  const realPathTrusted =
    score &&
    score.product_real_path_score === 1 &&
    score.harness_real_path_score === 1 &&
    score.subject_only_mutations === 0 &&
    score.target_not_executed === 0 &&
    score.survived === 0 &&
    score.mass_failures === 0 &&
    score.restore_failures === 0

  if (status === 'PASS' && realPathTrusted) {
    verdict = 'E2E_SUITE_TRUSTED'
    resume_readiness = 'READY_FOR_FULL_RESUME'
  } else if (status === 'PASS' && !realPathTrusted) {
    // Never claim TRUSTED without real-path 100%
    verdict = 'E2E_SUITE_INCOMPLETE'
    resume_readiness = 'HOLD'
    reason = reason || 'REAL_PATH_MUTATION_PROOF_REQUIRED'
    status = 'INCOMPLETE'
  } else if (incomplete_reason === 'REAL_PATH_MUTATION_SURVIVED' || status === 'MUTATION_SURVIVED') {
    verdict = 'E2E_SUITE_UNTRUSTED'
    reason = 'REAL_PATH_MUTATION_SURVIVED'
  } else if (status === 'FALSE_PASS_DETECTED') {
    verdict = 'E2E_SUITE_UNTRUSTED'
  } else if (status === 'INCOMPLETE' || status === 'DIRTY_WORKTREE' || status === 'ORACLE_NOT_INDEPENDENT') {
    verdict = 'E2E_SUITE_INCOMPLETE'
    reason = reason || (status === 'INCOMPLETE' ? 'REAL_PATH_MUTATION_PROOF_REQUIRED' : undefined)
  } else {
    verdict = 'BLOCKED'
  }

  const cap = gates.capability_id_coverage as Record<string, unknown> | undefined
  clearHarnessVersionCache()
  let liveHarness: Record<string, unknown> = {}
  try {
    liveHarness = computeHarnessVersion() as unknown as Record<string, unknown>
  } catch (e) {
    liveHarness = { error: String(e) }
  }
  const summary = {
    run_id: runId,
    ownership: OWNERSHIP,
    status,
    verdict,
    resume_readiness,
    incomplete_reason: reason,
    base_commit: String(liveHarness.git_commit || process.env.GDC_XP_COMMIT || ''),
    fixed_harness: String(liveHarness.harness_version || ''),
    prior_incomplete_harness: '6751c96450fd162c14c87d2cf82f19dc2eac4fd385d3f113843ec28638592d12',
    product_commit_base: '42c4092270af0c789327d218cd805766f7317bdd',
    prior_harnesses_not_mixed: [
      '6751c96450fd162c14c87d2cf82f19dc2eac4fd385d3f113843ec28638592d12',
      '009daf57881a515e73d7ef388eb1bd9bdd6e82bb2a9166fe3479b50bf5e2e307',
      'e929e4426774d9b4c5662b3508e7dad619b96851d20f3677e6a80459df0beece',
    ],
    recovery_worktree: process.cwd(),
    harness_scope_file_count: liveHarness.scope_file_count ?? null,
    gate_fields: {
      product_real_path_mutations_total: score?.product_real_path_mutations_total ?? null,
      product_real_path_killed: score?.product_real_path_killed ?? null,
      harness_real_path_mutations_total: score?.harness_real_path_mutations_total ?? null,
      harness_real_path_killed: score?.harness_real_path_killed ?? null,
      subject_only_mutations: score?.subject_only_mutations ?? null,
      target_not_executed: score?.target_not_executed ?? null,
      survived: score?.survived ?? null,
      mass_failures: score?.mass_failures ?? null,
      restore_failures: score?.restore_failures ?? null,
      direct_capability_mappings: cap?.direct_capability_mappings ?? null,
      capability_mapping_missing: Array.isArray(cap?.capability_mapping_missing)
        ? (cap?.capability_mapping_missing as string[]).length
        : null,
      trace_evidence_missing: (gates.real_path_trace_coverage as any)?.missing_trace?.length ?? null,
      recovery_artifact_changes: (gates.recovery_integrity as any)?.changed?.length ?? null,
    },
    gates,
    created_at: new Date().toISOString(),
  }
  writeJson(path.join(reportDir, 'suite-validation-summary.json'), summary)

  const md = [
    '# Suite Validation Report (Real-path Trust)',
    '',
    `- Run ID: ${runId}`,
    `- Status: ${status}`,
    `- Verdict: ${verdict}${reason ? ` — ${reason}` : ''}`,
    `- Resume: ${resume_readiness}`,
    '',
    '## Gate Fields',
    '',
    '```json',
    JSON.stringify(summary.gate_fields, null, 2),
    '```',
    '',
    '## Gates',
    '',
    '```json',
    JSON.stringify(gates, null, 2),
    '```',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(reportDir, 'suite-validation-report.md'), md)
  return { status, verdict, resume_readiness, reportDir, incomplete_reason: reason }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('suite-validation-gate.ts'))

if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  runSuiteValidationGate(opts).then((r) => {
    console.log(
      JSON.stringify(
        {
          status: r.status,
          verdict: r.verdict,
          resume_readiness: r.resume_readiness,
          incomplete_reason: r.incomplete_reason,
          reportDir: r.reportDir,
        },
        null,
        2,
      ),
    )
    process.exit(r.status === 'PASS' && r.verdict === 'E2E_SUITE_TRUSTED' ? 0 : 1)
  })
}
