import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SUITE_VALIDATION_ROOT } from './paths.js'

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

export function readYamlOrJson<T>(file: string): T {
  const raw = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.json')) return JSON.parse(raw) as T
  return parseYaml(raw) as T
}

export function suitePath(...parts: string[]): string {
  return path.join(SUITE_VALIDATION_ROOT, ...parts)
}
