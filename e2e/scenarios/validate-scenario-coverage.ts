#!/usr/bin/env npx tsx
/**
 * Validate generated scenario coverage against Capability Manifest.
 * Fails if any SUPPORTED capability lacks a scenario.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  CoverageValidationResult,
  E2EScenario,
  Manifest,
  MatrixBundle,
} from './scenario-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const MANIFEST = path.join(ROOT, 'e2e/capabilities/data-relay-capabilities.yaml')
const FULL_MATRIX = path.join(__dirname, 'generated', 'full-matrix.json')

function loadManifest(): Manifest {
  const py = `
import json, yaml, sys
with open(sys.argv[1]) as f:
    print(json.dumps(yaml.safe_load(f)))
`
  const raw = execFileSync('python3', ['-c', py, MANIFEST], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 })
  return JSON.parse(raw) as Manifest
}

function allCapabilityIds(manifest: Manifest): Map<string, string> {
  const map = new Map<string, string>()
  for (const section of [
    'authentication',
    'sources',
    'destinations',
    'wizard',
    'processing',
    'routes',
    'governance',
    'runtime',
    'feature_flags',
    'test_infrastructure',
  ] as const) {
    for (const c of manifest[section]) {
      map.set(c.id, c.status)
    }
  }
  return map
}

function validateSourceAuthCombo(s: E2EScenario): string | null {
  if (!s.source?.type || !s.source.authentication) return null
  const t = s.source.type
  const a = s.source.authentication
  const ok: Record<string, Set<string>> = {
    HTTP_API_POLLING: new Set([
      'no_auth',
      'basic',
      'bearer',
      'api_key',
      'oauth2_client_credentials',
      'session_login',
      'jwt_refresh_token',
      'vendor_jwt_exchange',
    ]),
    S3_OBJECT_POLLING: new Set(['s3_keys']),
    DATABASE_QUERY: new Set(['db_password']),
    REMOTE_FILE_POLLING: new Set(['ssh']),
    WEBHOOK_RECEIVER: new Set(['inbound']),
  }
  const allowed = ok[t]
  if (!allowed) return `Unknown source type ${t}`
  if (!allowed.has(a)) return `Invalid source/auth combo: ${t} × ${a}`
  return null
}

function validateDestCombo(s: E2EScenario): string | null {
  if (!s.destination?.type) return null
  const allowed = new Set(['WEBHOOK_POST', 'SYSLOG_UDP', 'SYSLOG_TCP', 'SYSLOG_TLS', 'AI_PROVIDER_POST'])
  if (!allowed.has(s.destination.type)) return `Invalid destination type ${s.destination.type}`
  return null
}

export function validateCoverage(manifest: Manifest, bundle: MatrixBundle): CoverageValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const caps = allCapabilityIds(manifest)
  const supported = [...caps.entries()].filter(([, st]) => st === 'SUPPORTED').map(([id]) => id)

  const ids = bundle.scenarios.map((s) => s.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  const duplicate_scenario_ids = [...new Set(dupes)]
  if (duplicate_scenario_ids.length) {
    errors.push(`Duplicate scenario IDs: ${duplicate_scenario_ids.join(', ')}`)
  }

  const unknown_capability_refs: string[] = []
  for (const s of bundle.scenarios) {
    for (const c of s.capabilities) {
      if (!caps.has(c)) unknown_capability_refs.push(c)
    }
    const srcErr = validateSourceAuthCombo(s)
    if (srcErr) errors.push(`${s.id}: ${srcErr}`)
    const destErr = validateDestCombo(s)
    if (destErr) errors.push(`${s.id}: ${destErr}`)
  }
  const uniqueUnknown = [...new Set(unknown_capability_refs)]
  if (uniqueUnknown.length) {
    errors.push(`Unknown capability refs: ${uniqueUnknown.join(', ')}`)
  }

  const covered = new Set<string>()
  for (const s of bundle.scenarios) {
    for (const c of s.capabilities) covered.add(c)
  }
  const supported_without_scenario = supported.filter((id) => !covered.has(id))
  if (supported_without_scenario.length) {
    errors.push(
      `SUPPORTED capabilities without scenarios (${supported_without_scenario.length}): ${supported_without_scenario.join(', ')}`,
    )
  }

  for (const n of bundle.not_applicable) {
    if (!n.reason || !n.reason.trim()) {
      errors.push(`NOT_APPLICABLE missing reason: ${n.combination}`)
    }
  }

  // Warn if PARTIAL was treated as PASS without reason
  for (const s of bundle.scenarios) {
    for (const c of s.capabilities) {
      const st = caps.get(c)
      if (st && st !== 'SUPPORTED' && s.expectedStatus === 'PASS' && !s.reason) {
        warnings.push(`${s.id} references non-SUPPORTED ${c} (${st}) with expectedStatus=PASS`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    supported_without_scenario,
    unknown_capability_refs: uniqueUnknown,
    duplicate_scenario_ids,
    stats: {
      supported_capabilities: supported.length,
      scenarios: bundle.scenarios.length,
      not_applicable: bundle.not_applicable.length,
    },
  }
}

function main(): void {
  if (!fs.existsSync(FULL_MATRIX)) {
    console.error('FAIL: full-matrix.json missing — run generate-full-matrix.ts first')
    process.exit(2)
  }
  const manifest = loadManifest()
  const bundle = JSON.parse(fs.readFileSync(FULL_MATRIX, 'utf-8')) as MatrixBundle
  const result = validateCoverage(manifest, bundle)
  const outPath = path.join(__dirname, 'generated', 'coverage-validation.json')
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8')
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) {
    process.exit(1)
  }
}

main()
