#!/usr/bin/env npx tsx
/**
 * CLI dispatcher for release-gate subcommands.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const COMMANDS: Record<string, string> = {
  evaluate: 'evaluate-release-gate.ts',
  'validate-evidence': 'validate-release-evidence.ts',
  'compare-baseline': 'compare-matrix-baseline.ts',
  rc: 'evaluate-rc-gate.ts',
  'detect-shards': 'detect-affected-shards.ts',
  flake: 'build-flake-report.ts',
  checksums: 'build-artifact-checksums.ts',
  'build-baseline': 'build-baseline.ts',
  'write-metadata': 'write-run-metadata.ts',
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === '-h' || cmd === '--help' || !COMMANDS[cmd]) {
    console.log(`Usage: release-gate <${Object.keys(COMMANDS).join('|')}> [args...]`)
    process.exit(cmd && COMMANDS[cmd] ? 0 : 2)
  }
  const script = path.join(__dirname, COMMANDS[cmd])
  const r = spawnSync('npx', ['tsx', script, ...rest], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
  })
  process.exit(r.status ?? 1)
}

main()
