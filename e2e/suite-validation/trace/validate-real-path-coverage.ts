#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAllTraces } from './trace-real-paths.js'

export function validateRealPathCoverage(reportDir: string): {
  status: 'PASS' | 'FAIL'
  total: number
  missing_trace: string[]
  target_not_executed: string[]
} {
  const traces = loadAllTraces(reportDir)
  const missing_trace: string[] = []
  const target_not_executed: string[] = []
  for (const t of traces) {
    if (!t.symbol_entered || t.invocation_count < 1) target_not_executed.push(t.mutation_id)
  }
  // Also check expected M01-M24 files if catalog present
  const catalogPath = path.resolve(__dirname, '../real-path/real-path-mutation-catalog.json')
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { mutations: { mutation_id: string }[] }
    const have = new Set(traces.map((t) => t.mutation_id))
    for (const m of catalog.mutations) {
      if (!have.has(m.mutation_id)) missing_trace.push(m.mutation_id)
    }
  }
  const status = missing_trace.length || target_not_executed.length ? 'FAIL' : 'PASS'
  return { status, total: traces.length, missing_trace, target_not_executed }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('validate-real-path-coverage.ts'))
if (isMain) {
  const reportDir = process.argv[2]
  if (!reportDir) {
    console.error('usage: validate-real-path-coverage.ts <reportDir>')
    process.exit(2)
  }
  const r = validateRealPathCoverage(reportDir)
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.status === 'PASS' ? 0 : 1)
}
