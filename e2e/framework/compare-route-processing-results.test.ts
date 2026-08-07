#!/usr/bin/env npx tsx
/**
 * Fixture unit checks for compare-route-processing-results.
 */
import assert from 'node:assert/strict'
import {
  compareRouteProcessingResults,
  normalizeScenarioKey,
} from './compare-route-processing-results.ts'

assert.equal(
  normalizeScenarioKey('srcdest__http__webhook__api__route-off'),
  normalizeScenarioKey('srcdest__http__webhook__api__route-on'),
)

{
  const report = compareRouteProcessingResults(
    [{ scenario_id: 'a__route-off', result: 'PASS' }],
    [{ scenario_id: 'a__route-on', result: 'PASS' }],
  )
  assert.equal(report.compared, 1)
  assert.equal(report.unexpected_total, 0)
}

{
  const report = compareRouteProcessingResults(
    [{ scenario_id: 'b__route-off', result: 'PASS' }],
    [{ scenario_id: 'b__route-on', result: 'FAIL', failure_classification: 'PRODUCT_RUNTIME' }],
  )
  assert.equal(report.status_mismatches, 1)
  assert.equal(report.failure_policy_mismatches, 1)
  assert.ok(report.unexpected_total >= 2)
}

{
  const report = compareRouteProcessingResults(
    [{ scenario_id: 'only_off__route-off', result: 'PASS' }],
    [{ scenario_id: 'only_on__route-on', result: 'PASS' }],
  )
  assert.equal(report.missing_in_off, 1)
  assert.equal(report.missing_in_on, 1)
}

{
  const report = compareRouteProcessingResults(
    [{ scenario_id: 'runtime__scheduler__source-http-api-polling__route-off', result: 'PASS' }],
    [],
  )
  assert.equal(report.allowed_implementation_differences, 1)
  assert.equal(report.missing_in_on, 0)
  assert.equal(report.unexpected_total, 0)
}

console.log('compare-route-processing-results fixtures: PASS')
