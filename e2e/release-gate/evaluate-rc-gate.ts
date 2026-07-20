#!/usr/bin/env npx tsx
/**
 * Release Candidate gate: require N consecutive Full Matrix PASS evaluations
 * on the same commit (with freshness checks).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  E2E_ROOT,
  finalDir,
  hoursSince,
  loadConfig,
  loadRunMetadata,
  readJson,
  writeGithubSummary,
  writeJson,
} from './lib.js'
import type { RcGateEvaluation, ReleaseGateEvaluation, ReleaseGateIssue, ReleaseGateStatus } from './release-gate-types.js'

function parseArgs(): { runIds: string[]; commit?: string; outDir?: string } {
  const args = process.argv.slice(2)
  const runIds: string[] = []
  let commit: string | undefined
  let outDir: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') runIds.push(args[++i] || '')
    else if (args[i] === '--runs') {
      const raw = args[++i] || ''
      runIds.push(...raw.split(',').map((s) => s.trim()).filter(Boolean))
    }
    else if (args[i] === '--commit') commit = args[++i]
    else if (args[i] === '--out-dir') outDir = args[++i]
  }
  if (runIds.length < 2) {
    console.error('Usage: evaluate-rc-gate.ts --run-id <a> --run-id <b> [--commit <sha>]')
    process.exit(2)
  }
  return { runIds, commit, outDir }
}

function main(): void {
  const { runIds, commit: expectCommit, outDir } = parseArgs()
  const config = loadConfig()
  const issues: ReleaseGateIssue[] = []
  const attempts: RcGateEvaluation['attempts'] = []
  let consecutive = 0
  let status: ReleaseGateStatus = 'PASS'
  let sharedCommit: string | undefined

  for (const runId of runIds) {
    const gate = readJson<ReleaseGateEvaluation>(path.join(finalDir(runId), 'release-gate.json'))
    const meta = loadRunMetadata(runId)
    const gateStatus = (gate?.status || 'INCOMPLETE') as ReleaseGateStatus
    attempts.push({
      run_id: runId,
      status: gateStatus,
      generated_at: gate?.generated_at || meta?.generated_at,
    })

    if (!gate) {
      status = 'INCOMPLETE'
      issues.push({
        code: 'RC_MISSING_GATE',
        severity: 'error',
        detail: `Missing release-gate.json for ${runId}`,
        artifact_path: path.join(finalDir(runId), 'release-gate.json'),
      })
      consecutive = 0
      continue
    }

    const c = meta?.git_commit || gate.commit
    if (!sharedCommit) sharedCommit = c
    if (c && sharedCommit && c !== sharedCommit) {
      status = 'STALE'
      issues.push({
        code: 'RC_COMMIT_DRIFT',
        severity: 'error',
        detail: `Attempt ${runId} commit ${c} != ${sharedCommit}`,
      })
      consecutive = 0
      continue
    }
    if (expectCommit && c && c !== expectCommit) {
      status = 'STALE'
      issues.push({
        code: 'RC_COMMIT_MISMATCH',
        severity: 'error',
        detail: `Attempt ${runId} commit ${c} != expected ${expectCommit}`,
      })
      consecutive = 0
      continue
    }

    const age = hoursSince(gate.generated_at || meta?.generated_at)
    if (age != null && age > config.release_candidate.max_result_age_hours) {
      status = 'STALE'
      issues.push({
        code: 'RC_RESULT_TOO_OLD',
        severity: 'error',
        detail: `${runId} age ${age.toFixed(1)}h > ${config.release_candidate.max_result_age_hours}h`,
      })
      consecutive = 0
      continue
    }

    if (gateStatus === 'PASS') {
      consecutive += 1
    } else {
      if (gateStatus === 'STALE') {
        // RC contract: any non-PASS attempt fails the RC gate (reported as FAIL with STALE cause)
        status = 'FAIL'
        issues.push({
          code: 'RC_ATTEMPT_STALE',
          severity: 'error',
          detail: `${runId} gate=STALE (RC requires consecutive PASS)`,
        })
      } else if (gateStatus === 'INCOMPLETE') {
        status = 'INCOMPLETE'
        issues.push({
          code: 'RC_ATTEMPT_INCOMPLETE',
          severity: 'error',
          detail: `${runId} gate=INCOMPLETE`,
        })
      } else {
        status = 'FAIL'
        issues.push({
          code: 'RC_ATTEMPT_NOT_PASS',
          severity: 'error',
          detail: `${runId} gate=${gateStatus}`,
        })
      }
      consecutive = 0
    }
  }

  if (consecutive < config.release_candidate.consecutive_passes) {
    if (status === 'PASS') status = 'FAIL'
    issues.push({
      code: 'RC_INSUFFICIENT_PASSES',
      severity: 'error',
      detail: `Consecutive PASS ${consecutive} < required ${config.release_candidate.consecutive_passes}`,
    })
  }

  const evaluation: RcGateEvaluation = {
    status: consecutive >= config.release_candidate.consecutive_passes && issues.every((i) => i.severity !== 'error')
      ? 'PASS'
      : status === 'PASS'
        ? 'FAIL'
        : status,
    commit: sharedCommit || expectCommit || 'unknown',
    attempts,
    consecutive_required: config.release_candidate.consecutive_passes,
    consecutive_pass: consecutive,
    issues,
    evaluated_at: new Date().toISOString(),
  }

  // Recompute final status cleanly
  // RC contract: insufficient consecutive PASS → FAIL (including STALE/FAIL attempts).
  // STALE reserved for evidence commit/age problems when attempts themselves claim PASS.
  if (evaluation.consecutive_pass >= evaluation.consecutive_required && !issues.some((i) => i.severity === 'error')) {
    evaluation.status = 'PASS'
  } else if (issues.some((i) => i.code.includes('MISSING') || i.code.includes('INCOMPLETE'))) {
    evaluation.status = 'INCOMPLETE'
  } else if (
    evaluation.consecutive_pass >= evaluation.consecutive_required &&
    issues.some((i) => i.code === 'RC_COMMIT_DRIFT' || i.code === 'RC_COMMIT_MISMATCH' || i.code === 'RC_RESULT_TOO_OLD')
  ) {
    evaluation.status = 'STALE'
  } else {
    evaluation.status = 'FAIL'
  }

  const dest = outDir || path.join(E2E_ROOT, 'reports', 'rc-gate')
  fs.mkdirSync(dest, { recursive: true })
  writeJson(path.join(dest, 'rc-gate.json'), evaluation)
  const md = [
    `# Release Candidate Gate`,
    '',
    `Status: **${evaluation.status}**`,
    `Commit: \`${evaluation.commit}\``,
    `Consecutive PASS: ${evaluation.consecutive_pass} / ${evaluation.consecutive_required}`,
    '',
    '| Attempt | Run ID | Status |',
    '| ---: | --- | --- |',
    ...evaluation.attempts.map((a, i) => `| ${i + 1} | \`${a.run_id}\` | ${a.status} |`),
    '',
    ...issues.map((i) => `- **${i.code}**: ${i.detail}`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dest, 'rc-gate.md'), md)
  writeGithubSummary(md)
  console.log(JSON.stringify(evaluation, null, 2))
  if (evaluation.status !== 'PASS') process.exit(1)
}

main()
