#!/usr/bin/env npx tsx
/**
 * Detect affected Full Matrix shards from git diff + capability evidence + scenario links.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  E2E_ROOT,
  allCapabilities,
  evidenceFiles,
  gitDiffNames,
  loadConfig,
  loadManifest,
  loadMatrix,
  writeJson,
} from './lib.js'
import type { AffectedShardsResult } from './release-gate-types.js'

const PATH_SHARD_HINTS: Array<{ pattern: RegExp; shards: string[]; fault?: boolean }> = [
  { pattern: /^app\/connectors\//, shards: ['authentication', 'http'] },
  { pattern: /^app\/connectors\/auth\//, shards: ['authentication'] },
  { pattern: /^app\/sources\//, shards: ['http', 'database', 'object-file'] },
  { pattern: /^app\/sources\/adapters\/http/, shards: ['http'] },
  { pattern: /^app\/sources\/adapters\/.*database|^app\/sources\/adapters\/.*postgres/i, shards: ['database'] },
  { pattern: /^app\/sources\/adapters\/s3|^app\/sources\/adapters\/.*file|^app\/sources\/adapters\/remote/i, shards: ['object-file'] },
  { pattern: /^app\/destinations\//, shards: ['destination'] },
  { pattern: /^app\/delivery\//, shards: ['destination', 'runtime'] },
  { pattern: /^app\/enrichers\/|^app\/mappers\//, shards: ['processing'] },
  { pattern: /^app\/route_policy\/|^app\/runners\/route/, shards: ['route'] },
  { pattern: /^app\/governance_/, shards: ['governance'] },
  { pattern: /^app\/runtime\/|^app\/runners\/|^app\/scheduler\/|^app\/pollers\//, shards: ['runtime'], fault: true },
  { pattern: /^app\/backfill\//, shards: ['runtime'] },
  { pattern: /^e2e\/framework\/|^e2e\/matrix\/|^e2e\/scenarios\/|^e2e\/lab\//, shards: [] }, // wide below
  { pattern: /^frontend\/src\/components\/(connectors|streams|destinations|governance)\//, shards: ['authentication', 'destination', 'governance'] },
]

const SUITE_TO_SHARD: Record<string, string[]> = {
  authentication: ['authentication'],
  source: ['http', 'database', 'object-file'],
  destination: ['destination'],
  wizard: ['authentication', 'destination'],
  processing: ['processing'],
  route: ['route'],
  governance: ['governance'],
  runtime: ['runtime'],
  fault: ['runtime'],
}

function parseArgs(): { base: string; head: string; out?: string } {
  const args = process.argv.slice(2)
  let base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : process.env.GDC_E2E_DIFF_BASE || 'origin/main'
  let head = process.env.GDC_E2E_DIFF_HEAD || 'HEAD'
  let out: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') base = args[++i] || base
    else if (args[i] === '--head') head = args[++i] || head
    else if (args[i] === '--out') out = args[++i]
    else if (args[i] === '--files') {
      // optional: read file list from path
      const fileList = args[++i]
      if (fileList && fs.existsSync(fileList)) {
        ;(globalThis as { __AFFECTED_FILES?: string[] }).__AFFECTED_FILES = fs
          .readFileSync(fileList, 'utf-8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      }
    }
  }
  return { base, head, out }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function pathMatchesEvidence(changed: string, evidencePath: string): boolean {
  const c = normalizePath(changed)
  const e = normalizePath(evidencePath)
  if (!e) return false
  if (c === e) return true
  if (c.startsWith(e.endsWith('/') ? e : `${e}/`)) return true
  if (e.startsWith(c.endsWith('/') ? c : `${c}/`)) return true
  // directory evidence like app/governance_quarantine
  if (!path.extname(e) && c.startsWith(`${e}/`)) return true
  return false
}

function main(): void {
  const { base, head, out } = parseArgs()
  const config = loadConfig()
  const injected = (globalThis as { __AFFECTED_FILES?: string[] }).__AFFECTED_FILES
  const files = (injected || gitDiffNames(base, head)).map(normalizePath)
  const reason: Record<string, string[]> = {}
  const shardSet = new Set<string>()
  let includeFault = false
  let includeSmoke = true
  let fallbackWide = false

  const add = (shard: string, file: string) => {
    shardSet.add(shard)
    if (!reason[shard]) reason[shard] = []
    if (!reason[shard].includes(file)) reason[shard].push(file)
  }

  if (!files.length) {
    fallbackWide = true
    for (const s of config.shards) add(s, '(no diff — wide selection)')
    includeFault = true
  }

  const frameworkTouched = files.some(
    (f) =>
      f.startsWith('e2e/framework/') ||
      f.startsWith('e2e/matrix/') ||
      f.startsWith('e2e/scenarios/') ||
      f.startsWith('e2e/lab/') ||
      f.startsWith('e2e/release-gate/') ||
      f === 'e2e/run-full-e2e-lab.sh' ||
      f.startsWith('.github/workflows/full-e2e'),
  )
  if (frameworkTouched) {
    fallbackWide = true
    for (const s of config.shards) add(s, files.find((f) => f.startsWith('e2e/') || f.startsWith('.github/')) || 'e2e/**')
    includeFault = true
  }

  // Path heuristics
  for (const file of files) {
    for (const hint of PATH_SHARD_HINTS) {
      if (hint.pattern.test(file)) {
        for (const s of hint.shards) add(s, file)
        if (hint.fault) includeFault = true
      }
    }
    if (/^app\/enrichers\/|^app\/mappers\//.test(file)) add('processing', file)
    if (/route_policy|runners\/route|GDC_ROUTE_PROCESSING/.test(file)) {
      add('route', file)
    }
    if (/governance/.test(file)) add('governance', file)
    if (/runtime|scheduler|stream_runner|stream_loader|checkpoint|dedup/.test(file)) {
      add('runtime', file)
      includeFault = true
    }
  }

  // Manifest evidence → capabilities → scenarios → shards
  const manifest = loadManifest()
  const matrix = loadMatrix()
  const caps = allCapabilities(manifest)
  const touchedCaps = new Set<string>()

  for (const file of files) {
    for (const cap of caps) {
      for (const ef of evidenceFiles(cap.evidence)) {
        if (pathMatchesEvidence(file, ef)) {
          touchedCaps.add(cap.id)
          // Map capability domain to shards via scenarios
          const linked = matrix.scenarios.filter((s) => s.capabilities.includes(cap.id))
          for (const s of linked) {
            const shards = s.shard
              ? [s.shard]
              : SUITE_TO_SHARD[s.suite] || []
            for (const sh of shards) add(sh, `${file} → ${cap.id}`)
            if (s.suite === 'fault' || s.suite === 'runtime') includeFault = true
          }
          if (!linked.length) {
            // capability section heuristics
            if (cap.id.startsWith('auth.')) add('authentication', `${file} → ${cap.id}`)
            else if (cap.id.startsWith('source.')) {
              add('http', `${file} → ${cap.id}`)
              add('database', `${file} → ${cap.id}`)
              add('object-file', `${file} → ${cap.id}`)
            } else if (cap.id.startsWith('destination.')) add('destination', `${file} → ${cap.id}`)
            else if (cap.id.startsWith('processing.') || cap.id.startsWith('transform.')) add('processing', `${file} → ${cap.id}`)
            else if (cap.id.startsWith('route.')) add('route', `${file} → ${cap.id}`)
            else if (cap.id.startsWith('governance.')) add('governance', `${file} → ${cap.id}`)
            else if (cap.id.startsWith('runtime.')) {
              add('runtime', `${file} → ${cap.id}`)
              includeFault = true
            }
          }
        }
      }
    }
  }

  // Route changes always need off+on
  const routeModes: Array<'off' | 'on'> = ['off', 'on']
  if ([...shardSet].includes('route') || files.some((f) => /route_policy|ROUTE_PROCESSING/.test(f))) {
    // already both
  }

  // If still empty → wide
  if (!shardSet.size) {
    fallbackWide = true
    for (const s of config.shards) add(s, '(unclassified changes — wide selection)')
    includeFault = true
  }

  // Validate shards against known list; keep only known
  const known = new Set(config.shards.concat(['fault']))
  const shards = [...shardSet].filter((s) => known.has(s)).sort()
  if (includeFault && !shards.includes('runtime')) {
    shards.push('runtime')
    reason.runtime = reason.runtime || []
    reason.runtime.push('(fault coupling)')
  }

  const result: AffectedShardsResult = {
    shards,
    route_modes: routeModes,
    include_smoke: includeSmoke,
    include_fault: includeFault,
    reason,
    fallback_wide: fallbackWide,
  }

  console.log(JSON.stringify(result, null, 2))
  if (out) writeJson(out, result)
  else writeJson(path.join(E2E_ROOT, 'reports', 'affected-shards.json'), result)
}

main()
