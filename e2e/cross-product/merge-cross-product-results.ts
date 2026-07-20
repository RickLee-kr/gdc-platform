#!/usr/bin/env npx tsx
/**
 * Merge shard cross-product result JSONL files into one.
 *
 * Rules:
 * 1. SUPERSEDED results (or paths under /original/ with superseded.json) are excluded
 * 2. Same combination_id with different harness hashes → unresolved FAIL (no silent overwrite)
 * 3. Same harness + same settings + same status → keep one
 * 4. Same harness + same settings + different status → only allow when GDC_XP_ALLOW_RERUN_REPLACE=1
 *    and both rows share harness_version; keep latest finishedAt with explicit resolution record
 * 5. Mixed harness versions across the final set → exit 1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type ResultRow = {
  combination_id?: string
  status?: string
  result_status?: string
  finishedAt?: string
  commit?: string
  git_commit?: string
  manifest_hash?: string
  applicability_rules_hash?: string
  axes_hash?: string
  executor_hash?: string
  driver_hash?: string
  spec_hash?: string
  oracle_hash?: string
  fixture_hash?: string
  harness_version?: string
  shard?: string
  [key: string]: unknown
}

type SettingKey = {
  commit: string
  manifest_hash: string
  applicability_rules_hash: string
  axes_hash: string
  harness_version: string
  executor_hash: string
  driver_hash: string
  oracle_hash: string
  fixture_hash: string
}

function collectJsonl(
  dir: string,
  name: string,
  out: string[],
  skippedDirs?: { count: number },
): void {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      // Preserve evidence under original/ / .bad-* but never merge them.
      if (
        ent.name === 'original' ||
        ent.name === 'superseded' ||
        ent.name.startsWith('.bad-') ||
        ent.name.startsWith('recovery-attempt-')
      ) {
        if (skippedDirs) skippedDirs.count += 1
        continue
      }
      collectJsonl(p, name, out, skippedDirs)
    } else if (ent.name === name) {
      out.push(p)
    }
  }
}

function isSupersededPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/')
  if (norm.includes('/original/') || norm.includes('/superseded/')) return true
  // Sibling superseded.json marks the whole shard artifact as excluded.
  let dir = path.dirname(filePath)
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'superseded.json'))) return true
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

function loadNearbyMetadata(filePath: string): Partial<SettingKey> {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 4; i++) {
    for (const name of ['harness-manifest.json', 'shard-manifest.json', 'run-metadata.json']) {
      const p = path.join(dir, name)
      if (!fs.existsSync(p)) continue
      try {
        const m = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>
        return {
          commit: m.commit || m.git_commit || '',
          manifest_hash: m.manifest_hash || '',
          applicability_rules_hash: m.applicability_rules_hash || '',
          axes_hash: m.axes_hash || '',
          harness_version: m.harness_version || '',
          executor_hash: m.executor_hash || '',
          driver_hash: m.driver_hash || '',
          oracle_hash: m.oracle_hash || '',
          fixture_hash: m.fixture_hash || '',
        }
      } catch {
        /* ignore */
      }
    }
    dir = path.dirname(dir)
  }
  return {}
}

function settingOf(row: ResultRow, filePath: string): SettingKey {
  const near = loadNearbyMetadata(filePath)
  return {
    commit: String(row.commit || row.git_commit || near.commit || ''),
    manifest_hash: String(row.manifest_hash || near.manifest_hash || ''),
    applicability_rules_hash: String(
      row.applicability_rules_hash || near.applicability_rules_hash || '',
    ),
    axes_hash: String(row.axes_hash || near.axes_hash || ''),
    harness_version: String(row.harness_version || near.harness_version || ''),
    executor_hash: String(row.executor_hash || near.executor_hash || ''),
    driver_hash: String(row.driver_hash || near.driver_hash || ''),
    oracle_hash: String(row.oracle_hash || near.oracle_hash || ''),
    fixture_hash: String(row.fixture_hash || near.fixture_hash || ''),
  }
}

function settingEqual(a: SettingKey, b: SettingKey): boolean {
  return (
    a.commit === b.commit &&
    a.manifest_hash === b.manifest_hash &&
    a.applicability_rules_hash === b.applicability_rules_hash &&
    a.axes_hash === b.axes_hash &&
    a.harness_version === b.harness_version &&
    a.executor_hash === b.executor_hash &&
    a.driver_hash === b.driver_hash &&
    a.oracle_hash === b.oracle_hash &&
    a.fixture_hash === b.fixture_hash
  )
}

function harnessKey(s: SettingKey): string {
  return [
    s.harness_version,
    s.executor_hash,
    s.driver_hash,
    s.oracle_hash,
    s.fixture_hash,
  ].join('|')
}

export function mergeCrossProductResults(opts: {
  from: string
  out: string
  allowRerunReplace?: boolean
}): {
  written: number
  unique: number
  excluded_superseded: number
  unresolved_conflicts: number
  harness_hash_mismatches: number
  unresolved: Array<Record<string, unknown>>
  ok: boolean
} {
  const allowRerunReplace =
    opts.allowRerunReplace ?? process.env.GDC_XP_ALLOW_RERUN_REPLACE === '1'
  const files: string[] = []
  const skippedDirs = { count: 0 }
  collectJsonl(opts.from, 'cross-product-results.jsonl', files, skippedDirs)
  files.sort()

  type Entry = { row: ResultRow; line: string; file: string; settings: SettingKey }
  const byId = new Map<string, Entry[]>()
  let excluded_superseded = skippedDirs.count

  for (const f of files) {
    if (isSupersededPath(f)) {
      excluded_superseded += 1
      continue
    }
    for (const line of fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as ResultRow
      if (row.status === 'SUPERSEDED' || row.result_status === 'SUPERSEDED') {
        excluded_superseded += 1
        continue
      }
      const key = row.combination_id || line
      const settings = settingOf(row, f)
      const list = byId.get(key) || []
      list.push({ row, line, file: f, settings })
      byId.set(key, list)
    }
  }

  const resolvedReruns: Array<Record<string, unknown>> = []
  const unresolved: Array<Record<string, unknown>> = []
  const chosen: Entry[] = []

  for (const [id, entries] of byId) {
    if (entries.length === 1) {
      chosen.push(entries[0]!)
      continue
    }
    const settings0 = entries[0]!.settings
    const sameSettings = entries.every((e) => settingEqual(e.settings, settings0))
    if (!sameSettings) {
      unresolved.push({
        combination_id: id,
        reason: 'harness_or_settings_mismatch',
        entries: entries.map((e) => ({
          file: e.file,
          run_hint: e.file,
          status: e.row.status,
          finishedAt: e.row.finishedAt,
          harness_version: e.settings.harness_version,
          executor_hash: e.settings.executor_hash,
          driver_hash: e.settings.driver_hash,
          settings: e.settings,
        })),
        selected: null,
        rationale: 'Different harness hashes or generation settings — refuse automatic overwrite',
      })
      continue
    }
    const statuses = new Set(entries.map((e) => e.row.status || ''))
    if (statuses.size === 1) {
      chosen.push(entries[0]!)
      continue
    }
    if (!allowRerunReplace) {
      unresolved.push({
        combination_id: id,
        reason: 'status_conflict_without_explicit_rerun',
        entries: entries.map((e) => ({
          file: e.file,
          status: e.row.status,
          finishedAt: e.row.finishedAt,
          harness_version: e.settings.harness_version,
        })),
        selected: null,
        rationale:
          'Same harness but conflicting status — set GDC_XP_ALLOW_RERUN_REPLACE=1 only for intentional same-harness re-runs',
      })
      continue
    }
    const sorted = [...entries].sort((a, b) =>
      String(a.row.finishedAt || '').localeCompare(String(b.row.finishedAt || '')),
    )
    const keep = sorted[sorted.length - 1]!
    chosen.push(keep)
    resolvedReruns.push({
      combination_id: id,
      kept: `${keep.row.status}@${keep.row.finishedAt || ''}`,
      dropped: sorted.slice(0, -1).map((e) => `${e.row.status}@${e.row.finishedAt || ''}`),
      harness_version: keep.settings.harness_version,
      rationale: 'explicit same-harness re-run replace (GDC_XP_ALLOW_RERUN_REPLACE=1)',
    })
  }

  chosen.sort((a, b) =>
    String(a.row.combination_id || '').localeCompare(String(b.row.combination_id || '')),
  )

  const harnessVersions = new Set(chosen.map((e) => harnessKey(e.settings)))
  const harness_hash_mismatches = harnessVersions.size > 1 ? harnessVersions.size : 0
  if (harness_hash_mismatches) {
    unresolved.push({
      combination_id: '*',
      reason: 'mixed_harness_versions_in_final_set',
      harness_keys: [...harnessVersions],
      selected: null,
      rationale: 'All final results must share the same harness version',
    })
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true })
  // Only write final rows when merge is clean enough to use; still write on harness mix for diagnostics.
  const body = chosen.map((e) => JSON.stringify(e.row)).join('\n')
  fs.writeFileSync(opts.out, body ? `${body}\n` : '')

  const ok = unresolved.length === 0
  const summary = {
    from: opts.from,
    out: opts.out,
    files: files.length,
    written: chosen.length,
    unique: chosen.length,
    excluded_superseded,
    duplicate_groups: [...byId.values()].filter((e) => e.length > 1).length,
    resolved_reruns: resolvedReruns.length,
    unresolved_conflicts: unresolved.length,
    harness_hash_mismatches,
    harness_versions: [...harnessVersions],
    resolvedReruns,
    unresolved,
    ok,
  }
  fs.writeFileSync(
    path.join(path.dirname(opts.out), 'cross-product-merge-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  return {
    written: chosen.length,
    unique: chosen.length,
    excluded_superseded,
    unresolved_conflicts: unresolved.length,
    harness_hash_mismatches,
    unresolved,
    ok,
  }
}

function main() {
  const from =
    process.argv.find((a) => a.startsWith('--from='))?.slice('--from='.length) ||
    process.env.GDC_XP_FROM ||
    (process.env.GDC_E2E_RUN_ID
      ? path.join(__dirname, '../reports', process.env.GDC_E2E_RUN_ID)
      : path.join(__dirname, '../reports'))
  const out =
    process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ||
    path.join(
      process.env.GDC_E2E_RUN_ID
        ? path.join(__dirname, '../reports', process.env.GDC_E2E_RUN_ID)
        : path.join(__dirname, '../reports'),
      'final',
      'cross-product-results.jsonl',
    )

  const result = mergeCrossProductResults({ from, out })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) {
    console.error(`ERROR: merge failed unresolved=${result.unresolved_conflicts} harness_mismatches=${result.harness_hash_mismatches}`)
    for (const u of result.unresolved.slice(0, 20)) {
      console.error(JSON.stringify(u, null, 2))
    }
    process.exit(1)
  }
}

const isMain =
  process.argv[1]?.includes('merge-cross-product-results') ||
  import.meta.url === `file://${process.argv[1]}`

if (isMain) {
  main()
}
