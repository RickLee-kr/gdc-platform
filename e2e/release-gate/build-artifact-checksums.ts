#!/usr/bin/env npx tsx
/**
 * Build artifact-checksums.json for a run (or shard subdirectory).
 */
import fs from 'node:fs'
import path from 'node:path'
import { finalDir, reportDir, sha256File, writeJson } from './lib.js'
import type { ArtifactChecksumManifest } from './release-gate-types.js'

function parseArgs(): { runId: string; shardDir?: string } {
  const args = process.argv.slice(2)
  let runId = process.env.GDC_E2E_RUN_ID || ''
  let shardDir: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') runId = args[++i] || runId
    else if (args[i] === '--shard-dir') shardDir = args[++i]
  }
  if (!runId) {
    console.error('Usage: build-artifact-checksums.ts --run-id <id> [--shard-dir <rel>]')
    process.exit(2)
  }
  return { runId, shardDir }
}

function collectFiles(root: string, relBase = ''): string[] {
  const out: string[] = []
  if (!fs.existsSync(root)) return out
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'playwright-html') continue
    const abs = path.join(root, ent.name)
    const rel = path.join(relBase, ent.name)
    if (ent.isDirectory()) out.push(...collectFiles(abs, rel))
    else if (
      /\.(json|jsonl|md|html|log|txt)$/i.test(ent.name) ||
      ent.name === 'artifact-checksums.json'
    ) {
      // skip writing checksum of self later
      if (ent.name !== 'artifact-checksums.json') out.push(rel)
    }
  }
  return out
}

function main(): void {
  const { runId, shardDir } = parseArgs()
  const base = shardDir ? path.join(reportDir(runId), shardDir) : reportDir(runId)
  const filesRel = collectFiles(base)
  // Prefer key artifacts explicitly
  const preferred = [
    'final/matrix-summary.json',
    'final/scenario-results.json',
    'final/execution-validation.json',
    'final/capability-coverage.json',
    'final/matrix-summary.html',
    'matrix-results.jsonl',
  ]
  const set = new Set(filesRel.map((f) => f.replace(/\\/g, '/')))
  for (const p of preferred) {
    if (fs.existsSync(path.join(base, p))) set.add(p)
  }

  const files: ArtifactChecksumManifest['files'] = []
  for (const rel of [...set].sort()) {
    const abs = path.join(base, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    // Cap to avoid huge binary trees — skip oversized logs > 20MB
    const st = fs.statSync(abs)
    if (st.size > 20 * 1024 * 1024) continue
    files.push({ path: rel.replace(/\\/g, '/'), sha256: sha256File(abs), bytes: st.size })
  }

  const manifest: ArtifactChecksumManifest = {
    run_id: runId,
    shard: shardDir,
    route_flag: process.env.GDC_ROUTE_PROCESSING_ENABLED,
    generated_at: new Date().toISOString(),
    files,
  }

  const outPath = shardDir
    ? path.join(reportDir(runId), shardDir, 'artifact-checksums.json')
    : path.join(finalDir(runId), 'artifact-checksums.json')
  writeJson(outPath, manifest)
  console.log(JSON.stringify({ ok: true, outPath, file_count: files.length }, null, 2))
}

main()
