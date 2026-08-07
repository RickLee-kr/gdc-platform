#!/usr/bin/env npx tsx
/**
 * Compare Full Matrix OFF vs ON runs for semantic parity.
 *
 * Usage:
 *   npx tsx framework/compare-route-processing-results.ts \
 *     --off-run-id <id> --on-run-id <id> [--out <dir>]
 *
 * Compares merged scenario-results plus per-scenario evidence when present:
 * status, checkpoint, delivery-log outcomes, failure classification, route metrics.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

type MergedResult = {
  scenario_id: string
  suite?: string
  execution_mode?: string
  route_processing?: string
  result: string
  failure_classification?: string
  reason?: string
  evidence_path?: string
}

export type ParityMismatch = {
  kind:
    | 'missing_in_off'
    | 'missing_in_on'
    | 'status'
    | 'checkpoint'
    | 'delivery'
    | 'failure_policy'
    | 'payload'
    | 'allowed_implementation'
  scenario_key: string
  off_id?: string
  on_id?: string
  detail: string
}

export type ParityReport = {
  compared: number
  missing_in_off: number
  missing_in_on: number
  status_mismatches: number
  checkpoint_mismatches: number
  delivery_mismatches: number
  failure_policy_mismatches: number
  payload_mismatches: number
  allowed_implementation_differences: number
  unexpected_total: number
  log_and_continue_parity: 'PASS' | 'FAIL' | 'N/A'
  partial_success_parity: 'PASS' | 'FAIL' | 'N/A'
  checkpoint_order_independent: 'PASS' | 'FAIL' | 'N/A'
  mismatches: ParityMismatch[]
}

function parseArgs(argv: string[]): {
  offRunId: string
  onRunId: string
  offResults?: string
  onResults?: string
  outDir: string
} {
  let offRunId = ''
  let onRunId = ''
  let offResults = ''
  let onResults = ''
  let outDir = ''
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--off-run-id') offRunId = argv[++i] || ''
    else if (a === '--on-run-id') onRunId = argv[++i] || ''
    else if (a === '--off-results') offResults = argv[++i] || ''
    else if (a === '--on-results') onResults = argv[++i] || ''
    else if (a === '--out') outDir = argv[++i] || ''
  }
  if (!offRunId || !onRunId) {
    throw new Error('Usage: --off-run-id <id> --on-run-id <id> [--out <dir>]')
  }
  if (!outDir) outDir = path.join(root, 'reports', `parity_${offRunId}_vs_${onRunId}`)
  return { offRunId, onRunId, offResults: offResults || undefined, onResults: onResults || undefined, outDir }
}

export function normalizeScenarioKey(scenarioId: string): string {
  return scenarioId
    .replace(/__route-off\b/g, '')
    .replace(/__route-on\b/g, '')
    .replace(/__route_processing_off\b/g, '')
    .replace(/__route_processing_on\b/g, '')
}

function loadMerged(resultsPath: string): MergedResult[] {
  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
  if (Array.isArray(raw)) return raw as MergedResult[]
  if (Array.isArray(raw.results)) return raw.results as MergedResult[]
  if (Array.isArray(raw.scenarios)) return raw.scenarios as MergedResult[]
  throw new Error(`Unrecognized results schema: ${resultsPath}`)
}

function readJsonSafe(file: string): unknown | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function checkpointFingerprint(data: unknown): string {
  if (data == null) return 'null'
  const body = (data as { body?: unknown }).body ?? data
  if (body == null || typeof body !== 'object') return JSON.stringify(body)
  const row = body as Record<string, unknown>
  const nested =
    row.checkpoint && typeof row.checkpoint === 'object'
      ? (row.checkpoint as Record<string, unknown>)
      : row.value && typeof row.value === 'object'
        ? (row.value as Record<string, unknown>)
        : null
  const pick = {
    cursor:
      row.cursor ??
      nested?.cursor ??
      nested?.value ??
      (typeof row.value !== 'object' ? row.value : undefined) ??
      row.position,
    object_key:
      row.object_key ??
      row.s3_key ??
      row.last_object_key ??
      nested?.object_key ??
      nested?.s3_key ??
      nested?.last_object_key,
    status: row.status ?? nested?.status,
    // Intentionally ignore updated_at / run ids — absolute wall-clock differs across OFF/ON runs.
  }
  return JSON.stringify(pick)
}

function deliveryFingerprint(data: unknown): string {
  if (data == null) return 'null'
  const body = (data as { body?: unknown }).body ?? data
  const text = JSON.stringify(body)
  const stages = Array.from(text.matchAll(/"stage"\s*:\s*"([^"]+)"/g)).map((m) => m[1].toLowerCase())
  const delivered = stages.some((s) => s.includes('route_send_success') || s.includes('delivery_success'))
  const completed = stages.some((s) => s.includes('run_complete'))
  const started = stages.some((s) => s.includes('run_started'))
  const hasRunFailed = stages.some((s) => s.includes('run_failed') || s.includes('route_send_fail'))
  // A later successful delivery absorbs transient run_failed noise (e.g. duplicate webhook no_events / lock retry).
  const failed = hasRunFailed && !(delivered && completed)
  const errors = Array.from(text.matchAll(/"error_code"\s*:\s*"([^"]+)"/g))
    .map((m) => m[1])
    .filter((code) => !(delivered && completed && code === 'RUNTIME_INTERNAL_ERROR'))
  errors.sort()
  const semantic = {
    delivered,
    completed,
    started,
    failed,
    absorbed:
      stages.some((s) => s.includes('failure_absorbed') || s.includes('log_and_continue')) ||
      /failure_absorbed|log_and_continue/i.test(text),
    blocked: /policy_deny|protection_block|quarantine/i.test(text),
  }
  return JSON.stringify({
    error_counts: countList(errors),
    semantic,
  })
}

function payloadFingerprint(data: unknown): string {
  if (data == null) return 'null'
  const scrub = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(scrub)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const key = k.toLowerCase()
        if (
          key.includes('timestamp') ||
          key.includes('updated_at') ||
          key.includes('created_at') ||
          key.includes('last_modified') ||
          key.includes('modified') ||
          key === 'id' ||
          key.endsWith('_id') ||
          key.includes('correlation') ||
          key.includes('run_id') ||
          key.includes('request_id') ||
          key.includes('remote_address') ||
          key === 'headers' ||
          key === 'host' ||
          key === 'raw_body' ||
          key === 'raw_message' ||
          key === 'status_response' ||
          key === 's3_etag' ||
          key === 'etag'
        ) {
          continue
        }
        if (key === 'body' || key === 'message') {
          out[k] = scrub(val)
          continue
        }
        out[k] = scrub(val)
      }
      return out
    }
    if (typeof v === 'string') {
      // Collapse absolute collector URLs / ephemeral ports / per-run correlation tokens.
      return v
        .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT')
        .replace(/:\d{4,5}\b/g, ':PORT')
        .replace(/full-e2e-corr-[a-z0-9_-]+/gi, 'full-e2e-corr-TOKEN')
        .replace(/wh-[a-z0-9_-]+/gi, 'wh-TOKEN')
        .replace(/msi[a-z0-9]+/gi, 'msiTOKEN')
    }
    return v
  }
  return JSON.stringify(scrub(data))
}

function isModeOnlyScenario(scenarioId: string): boolean {
  // Matrix entries that intentionally exist for only one route mode (or partial stubs).
  const id = scenarioId.toLowerCase()
  return (
    id.includes('__partial') ||
    id.includes('runtime_only') ||
    id.includes('ui_only') ||
    id.includes('scheduler__') ||
    id.includes('testinfra__') ||
    id.includes('wizard-step-route-processing') ||
    id.includes('wizard-feature-resume') ||
    id.includes('wizard-feature-stream-edit') ||
    id.includes('auth-destination-webhook-headers') ||
    id.includes('routes-per-route-') ||
    (id.includes('destination-') && id.includes('__lifecycle__')) ||
    id.includes('flag__flag-') ||
    id.includes('governance__governance-schema-drift') ||
    id.includes('governance__governance-classification') ||
    id.includes('governance__governance-policy') ||
    id.includes('runtime__runtime-')
  )
}

function countList(items: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) out[i] = (out[i] || 0) + 1
  return out
}

function isLogAndContinueScenario(id: string, reason?: string): boolean {
  const blob = `${id} ${reason || ''}`.toLowerCase()
  return (
    blob.includes('log_and_continue') ||
    blob.includes('log-and-continue') ||
    blob.includes('partial_route_failure')
  )
}

function isPartialSuccessScenario(id: string, reason?: string): boolean {
  const blob = `${id} ${reason || ''}`.toLowerCase()
  return blob.includes('partial') || blob.includes('failover') || blob.includes('multi-route')
}

/** Allowed when route-on path records extra route-scoped metrics without changing outcome. */
function isAllowedImplementationDiff(kind: string, detail: string): boolean {
  if (kind === 'delivery') {
    return /implementation stage|route_processing|shared_batch/i.test(detail)
  }
  if (kind === 'missing_in_off' || kind === 'missing_in_on') {
    return /mode-only|partial|route-off-only|route-on-only/i.test(detail)
  }
  return false
}

export function compareRouteProcessingResults(
  offResults: MergedResult[],
  onResults: MergedResult[],
  opts?: {
    offEvidenceRoot?: string
    onEvidenceRoot?: string
  },
): ParityReport {
  const offMap = new Map<string, MergedResult>()
  const onMap = new Map<string, MergedResult>()
  for (const r of offResults) offMap.set(normalizeScenarioKey(r.scenario_id), r)
  for (const r of onResults) onMap.set(normalizeScenarioKey(r.scenario_id), r)

  const keys = new Set([...offMap.keys(), ...onMap.keys()])
  const mismatches: ParityMismatch[] = []
  let compared = 0
  let lacCompared = 0
  let lacFail = 0
  let partialCompared = 0
  let partialFail = 0
  let checkpointCompared = 0
  let checkpointFail = 0

  for (const key of [...keys].sort()) {
    const off = offMap.get(key)
    const on = onMap.get(key)
    if (!off) {
      const detail = isModeOnlyScenario(on?.scenario_id || key)
        ? 'mode-only / route-on-only scenario'
        : 'present in ON only'
      mismatches.push({
        kind: isAllowedImplementationDiff('missing_in_off', detail) ? 'allowed_implementation' : 'missing_in_off',
        scenario_key: key,
        on_id: on?.scenario_id,
        detail,
      })
      continue
    }
    if (!on) {
      const detail = isModeOnlyScenario(off.scenario_id || key)
        ? 'mode-only / route-off-only scenario'
        : 'present in OFF only'
      mismatches.push({
        kind: isAllowedImplementationDiff('missing_in_on', detail) ? 'allowed_implementation' : 'missing_in_on',
        scenario_key: key,
        off_id: off.scenario_id,
        detail,
      })
      continue
    }
    compared++

    if (off.result !== on.result) {
      mismatches.push({
        kind: 'status',
        scenario_key: key,
        off_id: off.scenario_id,
        on_id: on.scenario_id,
        detail: `OFF=${off.result} ON=${on.result}`,
      })
    }

    const offClass = off.failure_classification || ''
    const onClass = on.failure_classification || ''
    if (offClass !== onClass) {
      mismatches.push({
        kind: 'failure_policy',
        scenario_key: key,
        off_id: off.scenario_id,
        on_id: on.scenario_id,
        detail: `OFF_class=${offClass || 'none'} ON_class=${onClass || 'none'}`,
      })
    }

    const offEv =
      opts?.offEvidenceRoot && off.scenario_id
        ? path.join(opts.offEvidenceRoot, off.scenario_id)
        : off.evidence_path
    const onEv =
      opts?.onEvidenceRoot && on.scenario_id
        ? path.join(opts.onEvidenceRoot, on.scenario_id)
        : on.evidence_path

    if (offEv && onEv && fs.existsSync(offEv) && fs.existsSync(onEv)) {
      const offCp = checkpointFingerprint(readJsonSafe(path.join(offEv, 'checkpoint.json')))
      const onCp = checkpointFingerprint(readJsonSafe(path.join(onEv, 'checkpoint.json')))
      if (offCp !== onCp) {
        checkpointCompared++
        checkpointFail++
        mismatches.push({
          kind: 'checkpoint',
          scenario_key: key,
          off_id: off.scenario_id,
          on_id: on.scenario_id,
          detail: `OFF=${offCp} ON=${onCp}`,
        })
      } else if (offCp !== 'null') {
        checkpointCompared++
      }

      const offDel = deliveryFingerprint(readJsonSafe(path.join(offEv, 'delivery-logs.json')))
      const onDel = deliveryFingerprint(readJsonSafe(path.join(onEv, 'delivery-logs.json')))
      if (offDel !== onDel) {
        mismatches.push({
          kind: 'delivery',
          scenario_key: key,
          off_id: off.scenario_id,
          on_id: on.scenario_id,
          detail: `OFF=${offDel} ON=${onDel}`,
        })
      }

      const offRecv = payloadFingerprint(readJsonSafe(path.join(offEv, 'received-payload.json')))
      const onRecv = payloadFingerprint(readJsonSafe(path.join(onEv, 'received-payload.json')))
      if (offRecv !== onRecv) {
        if (offRecv === 'null' || onRecv === 'null') {
          mismatches.push({
            kind: 'allowed_implementation',
            scenario_key: key,
            off_id: off.scenario_id,
            on_id: on.scenario_id,
            detail: 'received-payload evidence missing on one side',
          })
        } else {
          mismatches.push({
            kind: 'payload',
            scenario_key: key,
            off_id: off.scenario_id,
            on_id: on.scenario_id,
            detail: `received-payload.json differs after volatile scrub: OFF=${offRecv.slice(0, 180)} ON=${onRecv.slice(0, 180)}`,
          })
        }
      }
    }

    if (isLogAndContinueScenario(key, off.reason || on.reason)) {
      lacCompared++
      if (off.result !== on.result || offClass !== onClass) lacFail++
    }
    if (isPartialSuccessScenario(key, off.reason || on.reason)) {
      partialCompared++
      if (off.result !== on.result) partialFail++
    }
  }

  const count = (k: ParityMismatch['kind']) => mismatches.filter((m) => m.kind === k).length
  const allowed = count('allowed_implementation')
  const unexpected =
    count('missing_in_off') +
    count('missing_in_on') +
    count('status') +
    count('checkpoint') +
    count('delivery') +
    count('failure_policy') +
    count('payload')

  return {
    compared,
    missing_in_off: count('missing_in_off'),
    missing_in_on: count('missing_in_on'),
    status_mismatches: count('status'),
    checkpoint_mismatches: count('checkpoint'),
    delivery_mismatches: count('delivery'),
    failure_policy_mismatches: count('failure_policy'),
    payload_mismatches: count('payload'),
    allowed_implementation_differences: allowed,
    unexpected_total: unexpected,
    log_and_continue_parity: lacCompared === 0 ? 'N/A' : lacFail === 0 ? 'PASS' : 'FAIL',
    partial_success_parity: partialCompared === 0 ? 'N/A' : partialFail === 0 ? 'PASS' : 'FAIL',
    checkpoint_order_independent:
      checkpointCompared === 0 ? 'N/A' : checkpointFail === 0 ? 'PASS' : 'FAIL',
    mismatches,
  }
}

function defaultResultsPath(runId: string): string {
  return path.join(root, 'reports', runId, 'final', 'scenario-results.json')
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const offPath = args.offResults || defaultResultsPath(args.offRunId)
  const onPath = args.onResults || defaultResultsPath(args.onRunId)
  if (!fs.existsSync(offPath)) throw new Error(`OFF results missing: ${offPath}`)
  if (!fs.existsSync(onPath)) throw new Error(`ON results missing: ${onPath}`)

  const report = compareRouteProcessingResults(loadMerged(offPath), loadMerged(onPath), {
    offEvidenceRoot: path.join(root, 'reports', args.offRunId),
    onEvidenceRoot: path.join(root, 'reports', args.onRunId),
  })

  fs.mkdirSync(args.outDir, { recursive: true })
  const outJson = path.join(args.outDir, 'parity-report.json')
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`)
  const summary = [
    `compared=${report.compared}`,
    `unexpected=${report.unexpected_total}`,
    `status=${report.status_mismatches}`,
    `checkpoint=${report.checkpoint_mismatches}`,
    `delivery=${report.delivery_mismatches}`,
    `failure_policy=${report.failure_policy_mismatches}`,
    `payload=${report.payload_mismatches}`,
    `allowed=${report.allowed_implementation_differences}`,
    `LOG_AND_CONTINUE=${report.log_and_continue_parity}`,
    `PARTIAL_SUCCESS=${report.partial_success_parity}`,
    `CHECKPOINT_ORDER=${report.checkpoint_order_independent}`,
  ].join(' ')
  fs.writeFileSync(path.join(args.outDir, 'parity-summary.txt'), `${summary}\n`)
  console.log(summary)
  console.log(`wrote ${outJson}`)
  process.exit(report.unexpected_total === 0 ? 0 : 1)
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  main()
}
