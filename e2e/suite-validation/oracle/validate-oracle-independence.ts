#!/usr/bin/env npx tsx
/**
 * Static import-graph independence gate for suite-validation oracle + golden runners.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SUITE = path.resolve(__dirname, '..')

const FORBIDDEN = [
  /from\s+['"](?:\.\.\/)*app\//,
  /from\s+['"].*\/app\/runtime\//,
  /from\s+['"].*route_policy\//,
  /from\s+['"].*cross-product\/oracle/,
  /from\s+['"].*smoke-oracle/,
  /from\s+['"].*composite-chain-fixture/,
  /require\(['"].*app\/runtime/,
]

const SCAN_DIRS = ['oracle', 'golden', 'subject', 'negative', 'lib']

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|js|mjs|cjs)$/.test(ent.name)) out.push(p)
  }
  return out
}

export function validateOracleIndependence(): {
  status: 'PASS' | 'ORACLE_NOT_INDEPENDENT'
  forbidden_imports: { file: string; line: number; text: string }[]
  scanned_files: number
} {
  const forbidden_imports: { file: string; line: number; text: string }[] = []
  let scanned = 0
  for (const d of SCAN_DIRS) {
    for (const file of walk(path.join(SUITE, d))) {
      scanned += 1
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((text, i) => {
        for (const re of FORBIDDEN) {
          if (re.test(text)) {
            forbidden_imports.push({
              file: path.relative(SUITE, file),
              line: i + 1,
              text: text.trim(),
            })
          }
        }
      })
    }
  }
  return {
    status: forbidden_imports.length ? 'ORACLE_NOT_INDEPENDENT' : 'PASS',
    forbidden_imports,
    scanned_files: scanned,
  }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('validate-oracle-independence.ts'))

if (isMain) {
  const r = validateOracleIndependence()
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.status === 'PASS' ? 0 : 2)
}
