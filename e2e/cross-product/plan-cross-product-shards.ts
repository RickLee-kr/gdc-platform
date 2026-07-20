#!/usr/bin/env npx tsx
/**
 * Deterministic weighted bin-packing shard planner for Cross-Product combinations.
 * Fault scenarios are placed on isolated-compose shards.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShardPlanEntry, ValidCombination } from './cross-product-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEN = path.join(__dirname, 'generated')

function readValid(): ValidCombination[] {
  const p = path.join(GEN, 'valid-combinations.jsonl')
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ValidCombination)
}

function isFault(row: ValidCombination): boolean {
  return row.axes.fault_type !== 'NONE'
}

export function planShards(opts?: { shardCount?: number }): {
  shards: ShardPlanEntry[]
  summary: Record<string, unknown>
} {
  const rows = readValid()
  const shardCount = Math.max(1, opts?.shardCount ?? Number(process.env.GDC_XP_SHARD_COUNT || '32'))

  const faultRows = rows.filter(isFault)
  const normalRows = rows.filter((r) => !isFault(r))

  // Sort deterministically by combination_id
  normalRows.sort((a, b) => a.combination_id.localeCompare(b.combination_id))
  faultRows.sort((a, b) => a.combination_id.localeCompare(b.combination_id))

  const normalShardCount = Math.max(1, shardCount - Math.min(8, Math.ceil(faultRows.length / 200) || 1))
  const bins: ShardPlanEntry[] = []

  for (let i = 0; i < normalShardCount; i++) {
    bins.push({
      shard_id: `xp-normal-${String(i).padStart(3, '0')}`,
      combination_ids: [],
      estimated_cost: 0,
      browser_count: 0,
      api_count: 0,
      fault_count: 0,
      route_off_count: 0,
      route_on_count: 0,
      isolated_compose: false,
    })
  }

  // Weighted bin packing: assign each row to the current lowest-cost bin (deterministic tie-break by shard_id)
  for (const row of normalRows) {
    bins.sort((a, b) => a.estimated_cost - b.estimated_cost || a.shard_id.localeCompare(b.shard_id))
    const bin = bins[0]
    bin.combination_ids.push(row.combination_id)
    bin.estimated_cost += row.estimated_cost
    if (row.axes.execution_surface === 'BROWSER') bin.browser_count += 1
    else bin.api_count += 1
    if (row.axes.route_runtime === 'ROUTE_OFF') bin.route_off_count += 1
    else bin.route_on_count += 1
  }

  // Restore normal shard order
  bins.sort((a, b) => a.shard_id.localeCompare(b.shard_id))

  const faultShardCount = Math.max(1, Math.min(8, Math.ceil(faultRows.length / Math.max(1, Math.ceil(faultRows.length / 8)))))
  const faultBins: ShardPlanEntry[] = []
  for (let i = 0; i < faultShardCount; i++) {
    faultBins.push({
      shard_id: `xp-fault-${String(i).padStart(3, '0')}`,
      combination_ids: [],
      estimated_cost: 0,
      browser_count: 0,
      api_count: 0,
      fault_count: 0,
      route_off_count: 0,
      route_on_count: 0,
      isolated_compose: true,
    })
  }
  for (const row of faultRows) {
    faultBins.sort((a, b) => a.estimated_cost - b.estimated_cost || a.shard_id.localeCompare(b.shard_id))
    const bin = faultBins[0]
    bin.combination_ids.push(row.combination_id)
    bin.estimated_cost += row.estimated_cost
    bin.fault_count += 1
    if (row.axes.execution_surface === 'BROWSER') bin.browser_count += 1
    else bin.api_count += 1
    if (row.axes.route_runtime === 'ROUTE_OFF') bin.route_off_count += 1
    else bin.route_on_count += 1
  }
  faultBins.sort((a, b) => a.shard_id.localeCompare(b.shard_id))

  const shards = [...bins, ...faultBins]
  const summary = {
    generated_at: new Date().toISOString(),
    total_combinations: rows.length,
    shard_count: shards.length,
    normal_shards: bins.length,
    fault_shards: faultBins.length,
    total_estimated_cost: shards.reduce((s, x) => s + x.estimated_cost, 0),
    by_shard: shards.map((s) => ({
      shard_id: s.shard_id,
      scenarios: s.combination_ids.length,
      estimated_cost: s.estimated_cost,
      browser_count: s.browser_count,
      api_count: s.api_count,
      fault_count: s.fault_count,
      route_off_count: s.route_off_count,
      route_on_count: s.route_on_count,
      isolated_compose: s.isolated_compose,
    })),
  }

  fs.mkdirSync(GEN, { recursive: true })
  fs.writeFileSync(path.join(GEN, 'shard-plan.json'), `${JSON.stringify({ shards }, null, 2)}\n`)
  fs.writeFileSync(path.join(GEN, 'shard-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
  return { shards, summary }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('plan-cross-product-shards.ts'))
if (isMain) planShards()
