/**
 * Cross-Product scenario loader — streams valid combinations / shard slices.
 * Reuses finalizeTestContext lifecycle via executor; does not reimplement cleanup.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CrossProductScenario, ValidCombination } from './cross-product-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEN = path.join(__dirname, 'generated')

function resolveValidCombinationsPath(): string {
  const fromEnv = process.env.GDC_XP_VALID_COMBINATIONS_PATH?.trim()
  if (fromEnv) return fromEnv
  return path.join(GEN, 'valid-combinations.jsonl')
}

function resolveShardPlanPath(): string {
  const fromEnv = process.env.GDC_XP_SHARD_PLAN_PATH?.trim()
  if (fromEnv) return fromEnv
  return path.join(GEN, 'shard-plan.json')
}

function loadCombinationIdsFromFile(filePath: string): string[] {
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function loadValidCombinations(): ValidCombination[] {
  const p = resolveValidCombinationsPath()
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ValidCombination)
}

export function loadShardPlan(): { shards: Array<{ shard_id: string; combination_ids: string[] }> } {
  return JSON.parse(fs.readFileSync(resolveShardPlanPath(), 'utf-8'))
}

export function toScenario(row: ValidCombination): CrossProductScenario {
  return {
    id: `cross_product__${row.combination_id}`,
    combination_id: row.combination_id,
    suite: 'cross_product',
    executionMode: row.axes.execution_surface === 'BROWSER' ? 'browser' : 'api_seeded',
    routeProcessing: row.axes.route_runtime === 'ROUTE_ON' ? 'on' : 'off',
    axes: row.axes,
    capabilities: row.capability_ids,
    fixture: 'composite-chain',
    expectedStatus: 'PASS',
    tags: [
      'cross-product',
      row.axes.source_type,
      row.axes.destination_type,
      row.axes.route_topology,
      row.axes.fault_type,
    ],
    estimatedCost: row.estimated_cost,
  }
}

export function filterCrossProductScenarios(opts?: {
  shardId?: string
  combinationIds?: string[]
  limit?: number
  executionSurface?: string
  routeRuntime?: string
}): CrossProductScenario[] {
  const shardId = opts?.shardId || process.env.GDC_XP_SHARD || ''
  const limit = opts?.limit ?? (process.env.GDC_XP_LIMIT ? Number(process.env.GDC_XP_LIMIT) : undefined)
  const idsFile = process.env.GDC_XP_COMBINATION_IDS_FILE?.trim() || ''
  const idsFromFile = idsFile ? loadCombinationIdsFromFile(idsFile) : []
  const idsEnv = process.env.GDC_XP_COMBINATION_IDS?.split(',').filter(Boolean) || []
  const combinationIds = opts?.combinationIds || (idsFromFile.length ? idsFromFile : idsEnv)

  let rows = loadValidCombinations()

  if (shardId) {
    const plan = loadShardPlan()
    const shard = plan.shards.find((s) => s.shard_id === shardId)
    if (!shard) throw new Error(`Unknown shard ${shardId}`)
    const set = new Set(shard.combination_ids)
    rows = rows.filter((r) => set.has(r.combination_id))
  }

  if (combinationIds.length) {
    const set = new Set(combinationIds)
    rows = rows.filter((r) => set.has(r.combination_id))
  }

  if (opts?.executionSurface || process.env.GDC_XP_EXECUTION_SURFACE) {
    const surface = opts?.executionSurface || process.env.GDC_XP_EXECUTION_SURFACE
    rows = rows.filter((r) => r.axes.execution_surface === surface)
  }
  if (opts?.routeRuntime || process.env.GDC_XP_ROUTE_RUNTIME) {
    const rr = opts?.routeRuntime || process.env.GDC_XP_ROUTE_RUNTIME
    rows = rows.filter((r) => r.axes.route_runtime === rr)
  }

  rows.sort((a, b) => a.combination_id.localeCompare(b.combination_id))
  if (limit && limit > 0) rows = rows.slice(0, limit)
  return rows.map(toScenario)
}
