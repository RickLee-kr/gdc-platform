#!/usr/bin/env npx tsx
/**
 * PR helper: map changed files → affected Cross-Product axis domains.
 * Does not sample/shrink — returns all matching combination filters for full execution.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const AXIS_PATH_RULES: Array<{ pattern: RegExp; axes: string[]; envFilters: Record<string, string> }> = [
  { pattern: /^app\/connectors\//, axes: ['source_auth', 'source_type'], envFilters: {} },
  { pattern: /^app\/sources\//, axes: ['source_type', 'collection_mode', 'incremental_fetch'], envFilters: {} },
  { pattern: /^app\/destinations\/|^app\/delivery\//, axes: ['destination_type', 'destination_auth_protocol'], envFilters: {} },
  { pattern: /^app\/enrichers\/|^app\/mappers\//, axes: ['field_mapping', 'timestamp_normalization', 'jsonata', 'regex'], envFilters: {} },
  {
    pattern: /^app\/route_policy\/|^app\/runners\/route_|^app\/routes\//,
    axes: ['route_runtime', 'route_topology'],
    envFilters: {},
  },
  {
    pattern: /^app\/governance_|^app\/protection\/|^app\/schema_drift|^app\/stream_governance\//,
    axes: ['protection_action', 'delivery_behavior', 'unknown_field_policy', 'sensitive_detection_profile'],
    envFilters: {},
  },
  { pattern: /^app\/runners\/stream_dedup|^app\/runtime\/incremental/, axes: ['dedup_strategy', 'incremental_fetch', 'checkpoint_strategy'], envFilters: {} },
  { pattern: /^e2e\/lab\/fault|^e2e\/framework\/fault/, axes: ['fault_type', 'replay_mode', 'failover_mode'], envFilters: {} },
  { pattern: /^frontend\/src\/components\/streams|^frontend\/src\/components\/connectors/, axes: ['execution_surface'], envFilters: { GDC_XP_EXECUTION_SURFACE: 'BROWSER' } },
  { pattern: /^e2e\/cross-product\//, axes: ['*'], envFilters: {} },
]

function changedFiles(): string[] {
  const base = process.env.GDC_E2E_DIFF_BASE || 'origin/main-v2'
  try {
    const out = execSync(`git -C "${ROOT}" diff --name-only ${base}...HEAD`, { encoding: 'utf-8' })
    return out.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function main() {
  const files = changedFiles()
  const axes = new Set<string>()
  const env: Record<string, string> = {}
  let all = false
  for (const f of files) {
    for (const rule of AXIS_PATH_RULES) {
      if (rule.pattern.test(f)) {
        for (const a of rule.axes) {
          if (a === '*') all = true
          else axes.add(a)
        }
        Object.assign(env, rule.envFilters)
      }
    }
  }
  const result = {
    changed_files: files.length,
    all_combinations: all || axes.size === 0,
    affected_axes: [...axes].sort(),
    env_filters: env,
    note: all || axes.size === 0
      ? 'Run full Cross-Product valid set (no sampling)'
      : 'Run all valid combinations touching affected axes (generator filter by axis values — no arbitrary shrink)',
  }
  const out = path.join(__dirname, 'generated', 'affected-axes.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
  // GitHub Actions output
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `all_combinations=${result.all_combinations}\n`)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `affected_axes=${result.affected_axes.join(',')}\n`)
  }
  console.log(JSON.stringify(result, null, 2))
}

main()
