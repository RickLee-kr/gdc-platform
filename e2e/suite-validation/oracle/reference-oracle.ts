/**
 * Independent Reference Oracle.
 * Rules:
 * - No product runtime imports
 * - No product governance/mapping/timestamp/mask helpers
 * - No reuse of e2e/cross-product/oracle
 * Uses only standard library + explicit golden math/string rules.
 */
import crypto from 'node:crypto'
import type { OracleExpectation, OracleGovernance, OracleRoute, OracleTransformConfig } from './oracle-contract.js'

function getPath(obj: Record<string, unknown>, pathExpr: string): unknown {
  const parts = pathExpr.replace(/^\$\./, '').split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function setPath(obj: Record<string, unknown>, pathExpr: string, value: unknown): void {
  const parts = pathExpr.replace(/^\$\./, '').split('.')
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (typeof cur[p] !== 'object' || cur[p] == null) cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

function oracleJsonata(expr: string, input: Record<string, unknown>): unknown {
  const trimmed = expr.trim()
  if (/^\$\.[A-Za-z0-9_.]+$/.test(trimmed)) return getPath(input, trimmed)
  if (trimmed.includes('&')) {
    return trimmed
      .split('&')
      .map((p) => p.trim())
      .map((p) => {
        if (p.startsWith('$.')) return String(getPath(input, p) ?? '')
        if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) return p.slice(1, -1)
        return p
      })
      .join('')
  }
  const arr = /^\$\.([A-Za-z0-9_]+)\[(\d+)\]\.([A-Za-z0-9_]+)$/.exec(trimmed)
  if (arr) {
    const list = input[arr[1]]
    if (!Array.isArray(list)) return undefined
    const row = list[Number(arr[2])] as Record<string, unknown> | undefined
    return row?.[arr[3]]
  }
  if (trimmed.startsWith('{')) {
    const asJson = trimmed.replace(/\$\.[A-Za-z0-9_.]+/g, (m) => JSON.stringify(getPath(input, m) ?? null))
    return JSON.parse(asJson)
  }
  return undefined
}

function oracleTimestamp(raw: unknown, mode: 'utc' | 'offset' | 'invalid_check'): string | null {
  if (raw == null) return null
  const s = String(raw)
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})([Zz]|[+-]\d{2}:\d{2})?$/.exec(s)
  if (!m) {
    const lab = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s)
    if (!lab) return mode === 'invalid_check' ? null : null
    return `${lab[3]}-${lab[1]}-${lab[2]}T${lab[4]}:${lab[5]}:${lab[6]}Z`
  }
  const base = `${m[1]}T${m[2]}`
  const off = m[3]
  if (!off || off === 'Z' || off === 'z') return `${base}Z`
  const sign = off[0] === '-' ? -1 : 1
  const hh = Number(off.slice(1, 3))
  const mm = Number(off.slice(4, 6))
  const utcMs = Date.parse(`${base}Z`) - sign * (hh * 3600 + mm * 60) * 1000
  if (Number.isNaN(utcMs)) return null
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function oracleMaskPartial(v: string): string {
  if (v.length <= 4) return '****'
  return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`
}

function oracleHash(v: string): string {
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex')
}

function oracleToken(v: string): string {
  return `tok_${crypto.createHash('sha256').update(`tokenize:${v}`).digest('hex').slice(0, 16)}`
}

function applyOracleTransform(event: Record<string, unknown>, cfg: OracleTransformConfig): {
  event: Record<string, unknown>
  invalid: boolean
} {
  const out = structuredClone(event)
  if (cfg.field_mapping) setPath(out, cfg.field_mapping.to, getPath(out, cfg.field_mapping.from))
  if (cfg.jsonata) setPath(out, cfg.jsonata.output, oracleJsonata(cfg.jsonata.expr, out))
  if (cfg.regex) {
    const cur = getPath(out, cfg.regex.field)
    if (typeof cur === 'string') {
      const re = new RegExp(cfg.regex.pattern)
      if (re.test(cur)) setPath(out, cfg.regex.field, cur.replace(re, cfg.regex.replace))
    }
  }
  let invalid = false
  if (cfg.timestamp) {
    const norm = oracleTimestamp(getPath(out, cfg.timestamp.field), cfg.timestamp.mode)
    if (norm == null) invalid = true
    else setPath(out, `${cfg.timestamp.field}_normalized`, norm)
  }
  return { event: out, invalid }
}

function applyOracleGov(event: Record<string, unknown>, gov: OracleGovernance): {
  event: Record<string, unknown> | null
  action: 'deliver' | 'block' | 'quarantine'
} {
  const allowed = new Set(gov.schema_fields)
  const unknown = Object.keys(event).filter((k) => !allowed.has(k))
  if (unknown.length && (gov.schema_drift === 'block' || gov.unknown_field === 'block')) {
    return { event: null, action: 'block' }
  }
  let working = { ...event }
  if (unknown.length && gov.unknown_field === 'drop') {
    for (const u of unknown) delete working[u]
  }
  const sensitive = new Set(gov.sensitive_fields || [])
  if (gov.confidential_detection) {
    for (const [k, v] of Object.entries(working)) {
      if (typeof v === 'string' && (/@/.test(v) || /\d{3}-\d{2}-\d{4}/.test(v))) sensitive.add(k)
    }
  }
  const p = gov.protection || 'none'
  if (p === 'block') return { event: null, action: 'block' }
  if (p === 'quarantine') return { event: working, action: 'quarantine' }
  for (const f of sensitive) {
    const cur = working[f]
    if (typeof cur !== 'string') continue
    if (p === 'mask_partial') working[f] = oracleMaskPartial(cur)
    else if (p === 'mask_full') working[f] = '********'
    else if (p === 'tokenize') working[f] = oracleToken(cur)
    else if (p === 'hash') working[f] = oracleHash(cur)
    else if (p === 'remove') delete working[f]
  }
  return { event: working, action: 'deliver' }
}

function mergeCfg(globalCfg: OracleTransformConfig, override?: OracleTransformConfig | null): OracleTransformConfig {
  return { ...globalCfg, ...(override || {}) }
}

export function computeReferenceOracle(opts: {
  auth_ok: boolean
  events: Record<string, unknown>[]
  global_transform: OracleTransformConfig
  governance: OracleGovernance
  routes: OracleRoute[]
  route_mode: 'route-on' | 'route-off'
  correlation_id: string
  expected_no_delivery?: boolean
  dedup_enabled?: boolean
  verification_fields: string[]
}): OracleExpectation {
  if (!opts.auth_ok) {
    return {
      auth_ok: false,
      delivery_statuses: [],
      collector_count: 0,
      expected_no_delivery: true,
      payloads_by_route: {},
      verification_fields: opts.verification_fields,
    }
  }
  const routes =
    opts.route_mode === 'route-off'
      ? [{ route_key: 'legacy', destination_type: opts.routes[0]?.destination_type || 'WEBHOOK_POST' }]
      : opts.routes

  const delivery_statuses: string[] = []
  const payloads_by_route: Record<string, Record<string, unknown>[]> = {}
  const seen = new Set<string>()
  let duplicate_skipped = 0

  for (const raw of opts.events) {
    const id = String(raw.event_id ?? raw.id ?? '')
    if (opts.dedup_enabled) {
      if (seen.has(id)) {
        duplicate_skipped += 1
        continue
      }
      seen.add(id)
    }
    for (const route of routes) {
      if (route.policy === 'block') {
        delivery_statuses.push('BLOCKED')
        continue
      }
      const tf = applyOracleTransform(raw, mergeCfg(opts.global_transform, route.transform_override))
      if (tf.invalid) {
        delivery_statuses.push('BLOCKED')
        continue
      }
      const govPolicy: OracleGovernance = {
        ...opts.governance,
        ...(route.protection_override ? { protection: route.protection_override } : {}),
      }
      const gov = applyOracleGov(tf.event, govPolicy)
      if (gov.action === 'block') {
        delivery_statuses.push('BLOCKED')
        continue
      }
      if (gov.action === 'quarantine') {
        delivery_statuses.push('QUARANTINED')
        continue
      }
      delivery_statuses.push('SUCCESS')
      const payload = { ...(gov.event || {}), e2e_correlation_id: opts.correlation_id }
      payloads_by_route[route.route_key] = payloads_by_route[route.route_key] || []
      payloads_by_route[route.route_key].push(payload)
    }
  }

  const collector_count = Object.values(payloads_by_route).reduce((n, a) => n + a.length, 0)
  return {
    auth_ok: true,
    delivery_statuses,
    collector_count,
    expected_no_delivery: Boolean(opts.expected_no_delivery) || collector_count === 0,
    payloads_by_route,
    checkpoint_advanced: collector_count > 0,
    duplicate_skipped,
    verification_fields: opts.verification_fields,
  }
}
