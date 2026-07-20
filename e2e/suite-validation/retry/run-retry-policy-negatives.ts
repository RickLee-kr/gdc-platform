#!/usr/bin/env npx tsx
/**
 * Retry-policy negative tests (no product assertion softening).
 * Pure policy/unit checks over lab-stability helpers + retry-policy.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMPTY_DELIVERY_RETRY_MAX,
  TRANSIENT_API_RETRY_MAX,
  isTransientApiError,
  shouldEnableEmptyDeliveryRetry,
} from '../../framework/lab-stability.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POLICY = path.resolve(__dirname, '../../cross-product/retry-policy.json')

type CaseResult = { id: string; ok: boolean; detail: string }

function assertCase(id: string, cond: boolean, detail: string): CaseResult {
  return { id, ok: cond, detail }
}

export function runRetryPolicyNegatives(): {
  ok: boolean
  passed: number
  failed: number
  cases: CaseResult[]
} {
  const policy = JSON.parse(fs.readFileSync(POLICY, 'utf-8')) as {
    empty_delivery_retry: { max_attempts: number; allowed_source_types: string[] }
    transient_api_retry: { max_attempts: number; never_retry_http_status: number[] }
  }

  const cases: CaseResult[] = []

  cases.push(
    assertCase(
      'R1_max_empty_delivery_is_1',
      EMPTY_DELIVERY_RETRY_MAX === 1 && policy.empty_delivery_retry.max_attempts === 1,
      `max=${EMPTY_DELIVERY_RETRY_MAX}`,
    ),
  )

  cases.push(
    assertCase(
      'R2_s3_continue_allows_retry',
      shouldEnableEmptyDeliveryRetry({
        sourceType: 'S3_OBJECT_POLLING',
        deliveryBehavior: 'continue',
      }) === true,
      'S3+continue must allow',
    ),
  )

  cases.push(
    assertCase(
      'R3_block_forbids_retry',
      shouldEnableEmptyDeliveryRetry({
        sourceType: 'S3_OBJECT_POLLING',
        deliveryBehavior: 'block',
        enableEmptyDeliveryRetry: true,
      }) === false,
      'block must forbid even if explicit enable',
    ),
  )

  cases.push(
    assertCase(
      'R4_quarantine_forbids_retry',
      shouldEnableEmptyDeliveryRetry({
        sourceType: 'S3_OBJECT_POLLING',
        deliveryBehavior: 'quarantine',
      }) === false,
      'quarantine must forbid',
    ),
  )

  cases.push(
    assertCase(
      'R5_non_s3_forbids_retry',
      shouldEnableEmptyDeliveryRetry({
        sourceType: 'DATABASE_QUERY',
        deliveryBehavior: 'continue',
      }) === false,
      'non-S3 must forbid',
    ),
  )

  cases.push(
    assertCase(
      'R6_socket_hang_up_is_transient',
      isTransientApiError(new Error('APIRequestContext.post: socket hang up')) === true,
      'socket hang up',
    ),
  )

  cases.push(
    assertCase(
      'R7_401_not_transient',
      isTransientApiError(new Error('API 401 Unauthorized')) === false,
      '401 must not retry',
    ),
  )

  cases.push(
    assertCase(
      'R8_403_not_transient',
      isTransientApiError(new Error('403 Forbidden')) === false,
      '403 must not retry',
    ),
  )

  cases.push(
    assertCase(
      'R9_payload_mismatch_not_transient',
      isTransientApiError(new Error('payload mismatch on field x')) === false,
      'payload mismatch',
    ),
  )

  cases.push(
    assertCase(
      'R10_transient_max_is_1',
      TRANSIENT_API_RETRY_MAX === 1 && policy.transient_api_retry.max_attempts === 1,
      `api_max=${TRANSIENT_API_RETRY_MAX}`,
    ),
  )

  cases.push(
    assertCase(
      'R11_policy_forbids_401_403',
      JSON.stringify(policy.transient_api_retry.never_retry_http_status) ===
        JSON.stringify([401, 403]),
      'policy never_retry_http_status',
    ),
  )

  // Evidence preservation contract (file naming) — static check of lab-stability source
  const labSrc = fs.readFileSync(
    path.resolve(__dirname, '../../framework/lab-stability.ts'),
    'utf-8',
  )
  cases.push(
    assertCase(
      'R12_preserves_attempt_evidence_files',
      labSrc.includes('lab-runstream-retry-attempt-1.json') &&
        labSrc.includes('lab-runstream-retry-attempt-2.json'),
      'attempt evidence filenames',
    ),
  )

  cases.push(
    assertCase(
      'R13_overwrite_only_seed',
      labSrc.includes('overwrite_only') && !/delete_object|list_objects.*delete/i.test(labSrc),
      'overwrite-only seed, no delete',
    ),
  )

  const passed = cases.filter((c) => c.ok).length
  const failed = cases.length - passed
  return { ok: failed === 0, passed, failed, cases }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('run-retry-policy-negatives.ts'))

if (isMain) {
  const r = runRetryPolicyNegatives()
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}
