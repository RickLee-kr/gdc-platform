import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const SUITE_VALIDATION_ROOT = path.resolve(__dirname, '..')
export const E2E_ROOT = path.resolve(SUITE_VALIDATION_ROOT, '..')
export const REPO_ROOT = path.resolve(E2E_ROOT, '..')
export const OWNERSHIP = 'e2e-suite-validation'

export function defaultReportsRoot(): string {
  return path.join(E2E_ROOT, 'reports')
}

export function makeRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `e2e_suite_validation_${ts}`
}

export function ensureReportDir(reportsRoot: string, runId: string): string {
  const dir = path.join(reportsRoot, runId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function resolvePathFromSuite(rel: string): string {
  return path.resolve(SUITE_VALIDATION_ROOT, rel)
}
