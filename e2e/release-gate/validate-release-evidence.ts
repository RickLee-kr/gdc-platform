#!/usr/bin/env npx tsx
/**
 * Validate report evidence metadata against a release target commit.
 * Mismatch → STALE (exit 1).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  computeManifestHash,
  computeScenarioHash,
  finalDir,
  gitCommit,
  hoursSince,
  loadConfig,
  loadRunMetadata,
  readJson,
  reportDir,
  writeGithubSummary,
  writeJson,
} from './lib.js'
import type { ReleaseGateIssue, ReleaseGateStatus, RunMetadata } from './release-gate-types.js'

function parseArgs(): {
  commit: string
  runId?: string
  maxAgeHours?: number
  requireMetadata: boolean
} {
  const args = process.argv.slice(2)
  let commit = ''
  let runId: string | undefined
  let maxAgeHours: number | undefined
  let requireMetadata = true
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--commit') commit = args[++i] || ''
    else if (a === '--run-id') runId = args[++i]
    else if (a === '--max-age-hours') maxAgeHours = Number(args[++i])
    else if (a === '--allow-missing-metadata') requireMetadata = false
  }
  if (!commit) commit = gitCommit()
  return { commit, runId, maxAgeHours, requireMetadata }
}

function validateMetadata(
  meta: RunMetadata | null,
  expectCommit: string,
  maxAge: number,
  requireMetadata: boolean,
): { status: ReleaseGateStatus; issues: ReleaseGateIssue[] } {
  const issues: ReleaseGateIssue[] = []
  if (!meta) {
    if (requireMetadata) {
      return {
        status: 'STALE',
        issues: [{ code: 'METADATA_MISSING', severity: 'error', detail: 'run-metadata.json missing' }],
      }
    }
    return { status: 'INCOMPLETE', issues: [{ code: 'METADATA_MISSING', severity: 'warning', detail: 'run-metadata.json missing' }] }
  }

  const requiredFields: Array<keyof RunMetadata> = [
    'git_commit',
    'generated_at',
    'manifest_hash',
    'scenario_hash',
    'run_id',
  ]
  for (const f of requiredFields) {
    if (!meta[f]) {
      issues.push({ code: 'METADATA_FIELD_MISSING', severity: 'error', detail: `Missing metadata field: ${String(f)}` })
    }
  }

  if (meta.git_commit && meta.git_commit !== expectCommit) {
    issues.push({
      code: 'COMMIT_MISMATCH',
      severity: 'error',
      detail: `Report commit ${meta.git_commit} != release commit ${expectCommit}`,
    })
  }

  const currentManifest = computeManifestHash()
  const currentScenario = computeScenarioHash()
  if (meta.manifest_hash && meta.manifest_hash !== currentManifest) {
    issues.push({
      code: 'MANIFEST_HASH_MISMATCH',
      severity: 'error',
      detail: `Manifest hash changed since report (${meta.manifest_hash.slice(0, 12)}… vs ${currentManifest.slice(0, 12)}…)`,
    })
  }
  if (meta.scenario_hash && meta.scenario_hash !== currentScenario && currentScenario !== 'missing') {
    issues.push({
      code: 'SCENARIO_HASH_MISMATCH',
      severity: 'error',
      detail: `Scenario hash changed since report (${meta.scenario_hash.slice(0, 12)}… vs ${currentScenario.slice(0, 12)}…)`,
    })
  }

  const age = hoursSince(meta.generated_at)
  if (age != null && age > maxAge) {
    issues.push({
      code: 'RESULT_TOO_OLD',
      severity: 'error',
      detail: `Result age ${age.toFixed(1)}h > ${maxAge}h`,
    })
  }

  const status: ReleaseGateStatus = issues.some((i) => i.severity === 'error')
    ? issues.some((i) => i.code.includes('MISMATCH') || i.code === 'RESULT_TOO_OLD' || i.code === 'METADATA_MISSING')
      ? 'STALE'
      : 'FAIL'
    : 'PASS'

  return { status, issues }
}

function main(): void {
  const { commit, runId, maxAgeHours, requireMetadata } = parseArgs()
  const config = loadConfig()
  const maxAge = maxAgeHours ?? config.release.max_result_age_hours

  const runIds = runId
    ? [runId]
    : fs
        .readdirSync(path.join(reportDir('').replace(/\/$/, '') || path.join(path.dirname(reportDir('x')), '')), {
          withFileTypes: true,
        })
        .filter(() => false)
        .map(() => '')

  // If no run-id, validate only explicit --run-id is required
  if (!runId) {
    console.error('Usage: validate-release-evidence.ts --commit <sha> --run-id <id>')
    process.exit(2)
  }

  void runIds
  const meta = loadRunMetadata(runId)
  const { status, issues } = validateMetadata(meta, commit, maxAge, requireMetadata)

  // Also scan shard-level metadata if present
  const shardMetas = fs.existsSync(reportDir(runId))
    ? fs
        .readdirSync(reportDir(runId), { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'final')
        .map((d) => readJson<RunMetadata>(path.join(reportDir(runId), d.name, 'run-metadata.json')))
        .filter(Boolean) as RunMetadata[]
    : []

  for (const sm of shardMetas) {
    if (sm.git_commit && sm.git_commit !== commit) {
      issues.push({
        code: 'SHARD_COMMIT_MISMATCH',
        severity: 'error',
        detail: `Shard ${sm.shard || sm.run_id} commit ${sm.git_commit} != ${commit}`,
      })
    }
  }

  const finalStatus: ReleaseGateStatus =
    issues.some((i) => i.code.includes('MISMATCH') || i.code === 'RESULT_TOO_OLD')
      ? 'STALE'
      : issues.some((i) => i.severity === 'error')
        ? status === 'PASS'
          ? 'FAIL'
          : status
        : 'PASS'

  const report = {
    status: finalStatus,
    expect_commit: commit,
    run_id: runId,
    metadata: meta,
    issues,
    validated_at: new Date().toISOString(),
  }

  const out = path.join(finalDir(runId), 'evidence-validation.json')
  writeJson(out, report)
  const md = [
    `# Evidence Validation — ${runId}`,
    '',
    `Status: **${finalStatus}**`,
    `Expected commit: \`${commit}\``,
    `Report commit: \`${meta?.git_commit || 'missing'}\``,
    '',
    ...issues.map((i) => `- **${i.code}**: ${i.detail}`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(finalDir(runId), 'evidence-validation.md'), md)
  writeGithubSummary(md)

  console.log(JSON.stringify(report, null, 2))
  if (finalStatus !== 'PASS') process.exit(1)
}

main()
