import crypto from 'node:crypto'
import fs from 'node:fs'
import { suitePath } from './io.js'

export function verifyRecoveryArtifactsUnchanged(): {
  status: 'PASS' | 'FAIL'
  changed: string[]
  checked: number
} {
  const baselinePath = suitePath('.recovery-baseline', 'pre-validation-hashes.json')
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
    hashes: Record<string, string>
  }
  const changed: string[] = []
  for (const [file, expected] of Object.entries(baseline.hashes)) {
    if (!fs.existsSync(file)) {
      changed.push(`${file}:MISSING`)
      continue
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if (actual !== expected) changed.push(file)
  }
  return { status: changed.length ? 'FAIL' : 'PASS', changed, checked: Object.keys(baseline.hashes).length }
}
