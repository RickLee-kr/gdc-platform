#!/usr/bin/env npx tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { readJson, writeJson } from '../lib/io.js'

export function buildMutationReport(mutationResultsPath: string, outDir: string): void {
  const data = readJson<any>(mutationResultsPath)
  const rows = data.results || []
  const critical = rows.filter((r: any) => String(r.mutation_id).startsWith('M') || String(r.mutation_id).startsWith('G'))
  const by = {
    KILLED: rows.filter((r: any) => r.outcome === 'KILLED').length,
    SURVIVED: rows.filter((r: any) => r.outcome === 'SURVIVED').length,
    INVALID_MUTATION: rows.filter((r: any) => r.outcome === 'INVALID_MUTATION').length,
    TIMEOUT: rows.filter((r: any) => r.outcome === 'TIMEOUT').length,
    ENVIRONMENT_FAILURE: rows.filter((r: any) => r.outcome === 'ENVIRONMENT_FAILURE').length,
  }
  const report = {
    summary: by,
    score: data.score,
    status: data.status,
    rows: rows.map((r: any) => ({
      mutation_id: r.mutation_id,
      outcome: r.outcome,
      killed_by: r.killed_by,
      restore_clean: r.restore_clean,
      unrelated_failures: r.unrelated_failures,
    })),
  }
  writeJson(path.join(outDir, 'mutation-report.json'), report)
  const md = [
    '# Mutation Report',
    '',
    `- Status: ${data.status}`,
    `- Score: ${data.score?.mutation_score}`,
    `- KILLED: ${by.KILLED}`,
    `- SURVIVED: ${by.SURVIVED}`,
    `- INVALID: ${by.INVALID_MUTATION}`,
    '',
    '| ID | Outcome | Killed By | Restore Clean |',
    '|---|---|---|---|',
    ...rows.map(
      (r: any) =>
        `| ${r.mutation_id} | ${r.outcome} | ${(r.killed_by || []).join('<br>') || '-'} | ${r.restore_clean} |`,
    ),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(outDir, 'mutation-report.md'), md)
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('build-mutation-report.ts'))
if (isMain) {
  const src = process.argv[2]
  const out = process.argv[3]
  buildMutationReport(src, out)
}
