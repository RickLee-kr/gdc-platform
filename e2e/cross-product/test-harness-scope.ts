#!/usr/bin/env npx tsx
/**
 * Harness scope sensitivity tests.
 * Verifies lab-stability / test-context / retry-policy changes alter harness_version.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearHarnessVersionCache,
  computeHarnessVersion,
  buildHarnessScope,
  HARNESS_SCOPE,
} from './harness-version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function withTempByteFlip(rel: string, fn: () => void): void {
  const abs = path.join(ROOT, rel)
  const original = fs.readFileSync(abs)
  try {
    fs.writeFileSync(abs, Buffer.concat([original, Buffer.from('\n')]))
    clearHarnessVersionCache()
    fn()
  } finally {
    fs.writeFileSync(abs, original)
    clearHarnessVersionCache()
  }
}

function main(): void {
  clearHarnessVersionCache()
  const base = computeHarnessVersion()
  assert(base.harness_version && base.harness_version.length === 64, 'harness_version sha256')
  assert(base.scope_file_count === HARNESS_SCOPE.length, `scope count ${base.scope_file_count}`)
  assert(base.test_context_hash, 'test_context_hash present')
  assert(base.lab_stability_hash, 'lab_stability_hash present')
  assert(base.retry_policy_hash, 'retry_policy_hash present')

  const scope = buildHarnessScope()
  assert(scope.every((e) => e.sha256.length === 64), 'all scope sha256')
  assert(
    scope.some((e) => e.path.endsWith('test-context.ts')),
    'test-context in scope',
  )
  assert(
    scope.some((e) => e.path.endsWith('lab-stability.ts')),
    'lab-stability in scope',
  )

  // Determinism
  clearHarnessVersionCache()
  const again = computeHarnessVersion()
  assert(again.harness_version === base.harness_version, 'deterministic harness')

  const probes = [
    'e2e/framework/test-context.ts',
    'e2e/framework/lab-stability.ts',
    'e2e/cross-product/retry-policy.json',
    'e2e/framework/fixture-client.ts',
  ]
  for (const rel of probes) {
    withTempByteFlip(rel, () => {
      const mutated = computeHarnessVersion()
      assert(
        mutated.harness_version !== base.harness_version,
        `harness must change when ${rel} changes`,
      )
    })
  }

  // Must differ from legacy incomplete harness if commit/env set to old value
  const OLD = '6751c96450fd162c14c87d2cf82f19dc2eac4fd385d3f113843ec28638592d12'
  assert(base.harness_version !== OLD, 'new harness must differ from incomplete g5 harness')

  console.log(
    JSON.stringify(
      {
        ok: true,
        harness_version: base.harness_version,
        scope_file_count: base.scope_file_count,
        probes_passed: probes.length,
        deterministic: true,
        differs_from_old: true,
      },
      null,
      2,
    ),
  )
}

main()
