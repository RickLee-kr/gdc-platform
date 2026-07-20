#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { suitePath } from '../lib/io.js'

type Mapping = {
  required_golden_ids: string[]
  optional_golden_ids?: string[]
  coverage_type: string[]
  evidence_required: boolean
  rationale?: string
  scope?: string
  status?: string
}

export function validateCapabilityIdCoverage(): {
  status: 'PASS' | 'FAIL'
  supported_capability_count: number
  direct_capability_mappings: number
  capability_mapping_missing: string[]
  broken_golden_references: string[]
  unknown_capability_ids: string[]
  unfounded_mappings: string[]
} {
  const mapPath = suitePath('golden', 'capability-golden-map.json')
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
    mappings: Record<string, Mapping>
    supported_total: number
  }
  const goldens = JSON.parse(fs.readFileSync(suitePath('golden', 'golden-scenarios.json'), 'utf8')) as {
    scenarios: { golden_id: string }[]
  }
  const goldenIds = new Set(goldens.scenarios.map((s) => s.golden_id))

  // Load manifest IDs via embedded list from map keys + supported_total check
  const capabilityYaml = fs.readFileSync(
    path.resolve(suitePath('..'), 'capabilities', 'data-relay-capabilities.yaml'),
    'utf8',
  )
  const manifestIds = new Set(
    [...capabilityYaml.matchAll(/^\s+- id:\s+([a-z0-9_.]+)\s*$/gm)].map((m) => m[1]),
  )
  const supportedIds = new Set<string>()
  // Parse SUPPORTED blocks loosely: id line followed within 5 lines by status SUPPORTED
  const lines = capabilityYaml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s+- id:\s+([a-z0-9_.]+)\s*$/)
    if (!m) continue
    const window = lines.slice(i, i + 6).join('\n')
    if (/status:\s*SUPPORTED/.test(window)) supportedIds.add(m[1])
  }

  const capability_mapping_missing: string[] = []
  const broken_golden_references: string[] = []
  const unknown_capability_ids: string[] = []
  const unfounded_mappings: string[] = []

  for (const [cid, entry] of Object.entries(map.mappings)) {
    if (!manifestIds.has(cid)) unknown_capability_ids.push(cid)
    if (!entry.rationale) unfounded_mappings.push(cid)
    for (const gid of [...(entry.required_golden_ids || []), ...(entry.optional_golden_ids || [])]) {
      if (!goldenIds.has(gid)) broken_golden_references.push(`${cid}->${gid}`)
    }
  }

  for (const cid of supportedIds) {
    const entry = map.mappings[cid]
    if (!entry) {
      capability_mapping_missing.push(cid)
      continue
    }
    if (entry.scope === 'OUT_OF_SUITE_SCOPE') continue
    if (entry.evidence_required && (!entry.required_golden_ids || entry.required_golden_ids.length === 0)) {
      capability_mapping_missing.push(cid)
    }
  }

  const status =
    capability_mapping_missing.length ||
    broken_golden_references.length ||
    unknown_capability_ids.length ||
    unfounded_mappings.length
      ? 'FAIL'
      : 'PASS'

  return {
    status,
    supported_capability_count: supportedIds.size,
    direct_capability_mappings: Object.keys(map.mappings).length,
    capability_mapping_missing,
    broken_golden_references,
    unknown_capability_ids,
    unfounded_mappings,
  }
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('validate-capability-id-coverage.ts'))
if (isMain) {
  const r = validateCapabilityIdCoverage()
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.status === 'PASS' ? 0 : 1)
}
