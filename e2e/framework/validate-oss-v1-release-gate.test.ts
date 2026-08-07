#!/usr/bin/env npx tsx
/**
 * Unit checks for validate-oss-v1-release-gate.
 */
import assert from 'node:assert/strict'
import {
  OSS_V1_ALLOWED_NON_PASS_STATUSES,
  classifyModeResults,
  evaluateOssV1ReleaseGate,
  isAllowedNonPassStatus,
} from './validate-oss-v1-release-gate.ts'

assert.ok(isAllowedNonPassStatus('NOT_IMPLEMENTED'))
assert.ok(isAllowedNonPassStatus('NOT_APPLICABLE'))
assert.ok(isAllowedNonPassStatus('KNOWN_PRODUCT_GAP'))
assert.ok(isAllowedNonPassStatus('BLOCKED'))
assert.equal(isAllowedNonPassStatus('SKIP'), false)
assert.equal(isAllowedNonPassStatus('FAIL'), false)
assert.ok(OSS_V1_ALLOWED_NON_PASS_STATUSES.includes('NOT_IMPLEMENTED'))

{
  const summary = classifyModeResults(
    [
      { scenario_id: 'a__route-off', result: 'PASS', route_processing: 'off' },
      {
        scenario_id: 'b__partial',
        result: 'NOT_IMPLEMENTED',
        reason: 'Manifest status=PARTIAL',
        route_processing: 'off',
      },
    ],
    { routeMode: 'off' },
  )
  assert.equal(summary.pass, 1)
  assert.equal(summary.non_pass, 1)
  assert.equal(summary.non_pass_breakdown.NOT_IMPLEMENTED, 1)
  assert.equal(summary.unexplained.length, 0)
  assert.equal(summary.classification_status, 'PASS')
}

{
  const summary = classifyModeResults(
    [{ scenario_id: 'skippy', result: 'SKIP', route_processing: 'off' }],
    { routeMode: 'off' },
  )
  assert.equal(summary.unexplained.length, 1)
  assert.equal(summary.classification_status, 'FAIL')
}

{
  const report = evaluateOssV1ReleaseGate({
    offResults: [
      {
        scenario_id: 'fault__partial_route_failure__api__route-off',
        result: 'PASS',
        reason: 'log_and_continue partial',
      },
      {
        scenario_id: 'gov__review__api__route-off',
        result: 'NOT_IMPLEMENTED',
        reason: 'Manifest status=PARTIAL',
      },
    ],
    onResults: [
      {
        scenario_id: 'fault__partial_route_failure__api__route-on',
        result: 'PASS',
        reason: 'log_and_continue partial',
      },
      {
        scenario_id: 'gov__review__api__route-on',
        result: 'NOT_IMPLEMENTED',
        reason: 'Manifest status=PARTIAL',
      },
    ],
    parity: {
      compared: 2,
      missing_in_off: 0,
      missing_in_on: 0,
      status_mismatches: 0,
      checkpoint_mismatches: 0,
      delivery_mismatches: 0,
      failure_policy_mismatches: 0,
      payload_mismatches: 0,
      allowed_implementation_differences: 0,
      unexpected_total: 0,
      log_and_continue_parity: 'PASS',
      partial_success_parity: 'PASS',
      checkpoint_order_independent: 'PASS',
      mismatches: [],
    },
  })
  assert.equal(report.parity.log_and_continue_parity, 'PASS')
  assert.equal(report.ok, true)
}

{
  const report = evaluateOssV1ReleaseGate({
    offResults: [{ scenario_id: 'x__route-off', result: 'PASS' }],
    onResults: [{ scenario_id: 'x__route-on', result: 'FAIL', failure_classification: 'PRODUCT_RUNTIME' }],
  })
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((i) => i.includes('parity status') || i.includes('ON FAIL')))
}

console.log('validate-oss-v1-release-gate fixtures: PASS')
