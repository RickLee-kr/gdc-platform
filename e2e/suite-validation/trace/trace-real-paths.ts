#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RealPathTraceEvidence } from './trace-contract.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function writeTraceEvidence(reportDir: string, evidence: RealPathTraceEvidence): string {
  const dir = path.join(reportDir, 'trace')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${evidence.mutation_id}.json`)
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n')
  return out
}

export function loadAllTraces(reportDir: string): RealPathTraceEvidence[] {
  const dir = path.join(reportDir, 'trace')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RealPathTraceEvidence)
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('trace-real-paths.ts'))
if (isMain) {
  console.log(JSON.stringify({ ok: true, module: 'trace-real-paths' }))
}
