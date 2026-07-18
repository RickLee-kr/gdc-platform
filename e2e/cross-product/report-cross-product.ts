#!/usr/bin/env npx tsx
/** Write human-readable Cross-Product report from generation summary + optional gate. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GenerationSummary } from './cross-product-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEN = path.join(__dirname, 'generated')

function main() {
  const summary = JSON.parse(
    fs.readFileSync(path.join(GEN, 'generation-summary.json'), 'utf-8'),
  ) as GenerationSummary
  const shardSummary = fs.existsSync(path.join(GEN, 'shard-summary.json'))
    ? JSON.parse(fs.readFileSync(path.join(GEN, 'shard-summary.json'), 'utf-8'))
    : null

  const md = `# Cross-Product Report

Generated: ${summary.generated_at}

## Counts
- Candidates (unique): ${summary.candidate_combinations}
- Candidate emissions (raw): ${summary.candidate_emissions ?? 'n/a'}
- Duplicate emissions: ${summary.duplicate_emissions ?? 'n/a'}
- Valid: ${summary.valid_combinations}
- NOT_APPLICABLE: ${summary.not_applicable_combinations}
- NOT_IMPLEMENTED combinations: ${summary.not_implemented_combinations ?? 0}
- Equation OK (C = V + NA + NI): ${summary.classification_equation_ok ?? 'n/a'}
- Browser: ${summary.browser_combinations}
- API: ${summary.api_combinations}
- route-off: ${summary.route_off_combinations}
- route-on: ${summary.route_on_combinations}
- combination_id_set_hash: \`${summary.combination_id_set_hash}\`

## NOT_IMPLEMENTED suite IDs (frozen 20)
${summary.not_implemented_scenario_ids.map((s) => `- ${s}`).join('\n')}

## By source
${Object.entries(summary.by_source)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## By destination
${Object.entries(summary.by_destination)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## By fault
${Object.entries(summary.by_fault)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## NA by rule
${Object.entries(summary.by_rule_reject)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Shards
${
  shardSummary
    ? `- Shard count: ${shardSummary.shard_count}\n- Total estimated cost: ${shardSummary.total_estimated_cost}`
    : '_Run plan-cross-product-shards_'
}
`

  const out = path.join(GEN, 'cross-product-report.md')
  fs.writeFileSync(out, md)
  console.log(out)
}

main()
