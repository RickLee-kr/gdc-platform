#!/usr/bin/env npx tsx
/**
 * Write / refresh run-metadata.json for a report tree.
 * Does not alter PASS/FAIL scenario results.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  buildRunMetadata,
  coverageValidationPass,
  detectSmokePass,
  executionValidationPass,
  finalDir,
  readJson,
  writeJson,
} from './lib.js'

function parseArgs(): {
  runId: string
  smokeRunId?: string
  commit?: string
  smokePass?: boolean
  coveragePass?: boolean
  executionPass?: boolean
} {
  const args = process.argv.slice(2)
  let runId = ''
  let smokeRunId: string | undefined
  let commit: string | undefined
  let smokePass: boolean | undefined
  let coveragePass: boolean | undefined
  let executionPass: boolean | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') runId = args[++i] || ''
    else if (args[i] === '--smoke-run-id') smokeRunId = args[++i]
    else if (args[i] === '--commit') commit = args[++i]
    else if (args[i] === '--smoke-pass') smokePass = args[++i] !== 'false'
    else if (args[i] === '--coverage-pass') coveragePass = args[++i] !== 'false'
    else if (args[i] === '--execution-pass') executionPass = args[++i] !== 'false'
  }
  if (!runId) {
    console.error('Usage: write-run-metadata.ts --run-id <id> [--smoke-run-id <id>]')
    process.exit(2)
  }
  return { runId, smokeRunId, commit, smokePass, coveragePass, executionPass }
}

function main(): void {
  const opts = parseArgs()
  const summary = readJson<{ generated_at?: string }>(path.join(finalDir(opts.runId), 'matrix-summary.json'))
  const validation = readJson<{ ok?: boolean }>(path.join(finalDir(opts.runId), 'execution-validation.json'))
  const smoke = typeof opts.smokePass === 'boolean' ? opts.smokePass : detectSmokePass(opts.runId, opts.smokeRunId)
  const coverage =
    typeof opts.coveragePass === 'boolean' ? opts.coveragePass : coverageValidationPass(opts.runId)
  const execution =
    typeof opts.executionPass === 'boolean'
      ? opts.executionPass
      : typeof validation?.ok === 'boolean'
        ? validation.ok
        : executionValidationPass(opts.runId)

  const meta = buildRunMetadata({
    run_id: opts.runId,
    git_commit: opts.commit,
    generated_at: summary?.generated_at || new Date().toISOString(),
    smoke_pass: smoke,
    coverage_validation_pass: coverage,
    execution_validation_pass: execution,
  })

  writeJson(path.join(finalDir(opts.runId), 'run-metadata.json'), meta)
  writeJson(path.join(finalDir(opts.runId), 'smoke-status.json'), {
    ok: smoke,
    pass: smoke,
    smoke_run_id: opts.smokeRunId || null,
  })

  // Copy coverage validation snapshot if available
  const covSrc = path.resolve(path.dirname(finalDir(opts.runId)), '..', 'scenarios', 'generated', 'coverage-validation.json')
  // e2e/scenarios/generated
  const covPath = path.resolve(finalDir(opts.runId), '..', '..', 'scenarios', 'generated', 'coverage-validation.json')
  if (fs.existsSync(covPath)) {
    fs.copyFileSync(covPath, path.join(finalDir(opts.runId), 'coverage-validation.json'))
  }
  void covSrc

  console.log(JSON.stringify(meta, null, 2))
}

main()
