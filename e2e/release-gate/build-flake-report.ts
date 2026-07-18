#!/usr/bin/env npx tsx
/**
 * Build flake report from merged scenario attempts.
 * Product assertion failures are not auto-retry targets; infra retries are tracked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { finalDir, loadConfig, readJson, writeGithubSummary, writeJson } from './lib.js'
import type { FlakeReport, FlakeScenarioRecord } from './release-gate-types.js'

type Merged = {
  scenario_id: string
  result: string
  attempt_count: number
  failure_classification?: string
  reason?: string
  attempts?: Array<{ result: string; at: string; classification?: string; reason?: string }>
}

function parseArgs(): { runId: string; historyDir?: string } {
  const args = process.argv.slice(2)
  let runId = process.env.GDC_E2E_RUN_ID || ''
  let historyDir: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') runId = args[++i] || runId
    else if (args[i] === '--history-dir') historyDir = args[++i]
  }
  if (!runId) {
    console.error('Usage: build-flake-report.ts --run-id <id>')
    process.exit(2)
  }
  return { runId, historyDir }
}

function isInfraRetry(reason?: string, classification?: string): boolean {
  const text = `${reason || ''} ${classification || ''}`.toLowerCase()
  return (
    text.includes('infra') ||
    text.includes('timeout') ||
    text.includes('econnrefused') ||
    text.includes('container') ||
    text.includes('collector') ||
    text.includes('wiremock') ||
    text.includes('test_infra') ||
    classification === 'TEST_INFRA'
  )
}

function main(): void {
  const { runId, historyDir } = parseArgs()
  const config = loadConfig()
  const resultsPath = path.join(finalDir(runId), 'scenario-results.json')
  const results = readJson<Merged[]>(resultsPath)
  if (!results) {
    console.error(`Missing ${resultsPath}`)
    process.exit(2)
  }

  // Historical first-fail-then-pass counts from prior flake reports
  const historyCounts = new Map<string, number>()
  if (historyDir && fs.existsSync(historyDir)) {
    for (const ent of fs.readdirSync(historyDir)) {
      if (!ent.endsWith('flake-report.json') && !ent.endsWith('.json')) continue
      const rep = readJson<FlakeReport>(path.join(historyDir, ent))
      if (!rep?.scenarios) continue
      for (const s of rep.scenarios) {
        if (s.is_flaky || (s.first_result !== 'PASS' && s.final_result === 'PASS')) {
          historyCounts.set(s.scenario_id, (historyCounts.get(s.scenario_id) || 0) + 1)
        }
      }
    }
  }

  const scenarios: FlakeScenarioRecord[] = []
  for (const r of results) {
    const attempts = r.attempts || []
    const first = attempts[0]?.result || r.result
    const final = r.result
    const attemptCount = r.attempt_count || attempts.length || 1
    let retryReason: string | undefined
    if (attemptCount > 1) {
      const firstAttempt = attempts[0]
      retryReason = firstAttempt?.reason || firstAttempt?.classification || r.reason
      // Product failures should not be retry-pass flaky unless infra
      if (!isInfraRetry(retryReason, firstAttempt?.classification || r.failure_classification)) {
        if (first !== 'PASS' && final === 'PASS') {
          retryReason = `non-infra-retry-suspected:${retryReason || 'unknown'}`
        }
      }
    }

    const historical = historyCounts.get(r.scenario_id) || 0
    const retryPass = first !== 'PASS' && final === 'PASS' && attemptCount > 1
    const isFlaky =
      retryPass ||
      historical + (retryPass ? 1 : 0) >= config.flake.min_retry_pass_events

    if (attemptCount > 1 || isFlaky) {
      scenarios.push({
        scenario_id: r.scenario_id,
        attempt_count: attemptCount,
        first_result: first,
        final_result: final,
        retry_reason: retryReason,
        historical_failures: historical + (retryPass ? 1 : 0),
        is_flaky: isFlaky,
      })
    }
  }

  const flaky = scenarios.filter((s) => s.is_flaky)
  const report: FlakeReport = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    flaky_count: flaky.length,
    flaky_threshold: config.flake.max_flaky_scenarios,
    exceeds_threshold: flaky.length > config.flake.max_flaky_scenarios,
    scenarios,
  }

  writeJson(path.join(finalDir(runId), 'flake-report.json'), report)
  const md = [
    `# Flake Report — ${runId}`,
    '',
    `Flaky: **${report.flaky_count}** (threshold ${report.flaky_threshold})`,
    `Exceeds: ${report.exceeds_threshold}`,
    '',
    ...flaky.slice(0, 50).map(
      (s) =>
        `- \`${s.scenario_id}\` first=${s.first_result} final=${s.final_result} attempts=${s.attempt_count} hist=${s.historical_failures}`,
    ),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(finalDir(runId), 'flake-report.md'), md)
  writeGithubSummary(md)
  console.log(JSON.stringify(report, null, 2))
  if (report.exceeds_threshold && config.flake.fail_gate_on_exceed) process.exit(1)
}

main()
