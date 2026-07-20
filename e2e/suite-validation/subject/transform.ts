/**
 * Suite-validation subject: transform contracts.
 * Independent from product JSONata/mapping/timestamp implementations.
 */

export type TransformConfig = {
  field_mapping?: { from: string; to: string } | null
  jsonata?: { expr: string; output: string } | null
  regex?: { field: string; pattern: string; replace: string } | null
  timestamp?: { field: string; mode: 'utc' | 'offset' | 'invalid_check' } | null
}

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

/** Minimal JSONata-like evaluator for golden expressions only. */
export function evalJsonataLite(expr: string, input: Record<string, unknown>): unknown {
  const trimmed = expr.trim()
  // $.field
  if (/^\$\.[A-Za-z0-9_.]+$/.test(trimmed)) return getPath(input, trimmed)
  // $.a & "-" & $.b
  if (trimmed.includes('&')) {
    const parts = trimmed.split('&').map((p) => p.trim())
    return parts
      .map((p) => {
        if (p.startsWith('$.')) return String(getPath(input, p) ?? '')
        if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
          return p.slice(1, -1)
        }
        return p
      })
      .join('')
  }
  // $.items[0].name
  const arr = /^\$\.([A-Za-z0-9_]+)\[(\d+)\]\.([A-Za-z0-9_]+)$/.exec(trimmed)
  if (arr) {
    const list = input[arr[1]]
    if (!Array.isArray(list)) return undefined
    const row = list[Number(arr[2])] as Record<string, unknown> | undefined
    return row?.[arr[3]]
  }
  // {"nested": {"v": $.x}}
  if (trimmed.startsWith('{')) {
    try {
      const asJson = trimmed.replace(/\$\.[A-Za-z0-9_.]+/g, (m) => JSON.stringify(getPath(input, m) ?? null))
      return JSON.parse(asJson)
    } catch {
      return undefined
    }
  }
  return undefined
}

export function normalizeTimestamp(raw: unknown, mode: 'utc' | 'offset' | 'invalid_check'): string | null {
  if (raw == null) return null
  const s = String(raw)
  if (mode === 'invalid_check') {
    const d = Date.parse(s)
    if (Number.isNaN(d)) return null
  }
  // Support "2026-07-02T09:15:30+09:00" and "2026-07-02 09:15:30"
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})([Zz]|[+-]\d{2}:\d{2})?$/.exec(s)
  if (!m) {
    // lab non-ISO
    const lab = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s)
    if (!lab) return mode === 'invalid_check' ? null : s
    const iso = `${lab[3]}-${lab[1]}-${lab[2]}T${lab[4]}:${lab[5]}:${lab[6]}Z`
    return iso
  }
  const base = `${m[1]}T${m[2]}`
  const off = m[3]
  if (!off || off === 'Z' || off === 'z') return `${base}Z`
  if (mode === 'utc' || mode === 'offset' || mode === 'invalid_check') {
    const sign = off[0] === '-' ? -1 : 1
    const hh = Number(off.slice(1, 3))
    const mm = Number(off.slice(4, 6))
    const utcMs = Date.parse(`${base}Z`) - sign * (hh * 3600 + mm * 60) * 1000
    return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  return `${base}Z`
}

export function applyTransforms(
  event: Record<string, unknown>,
  cfg: TransformConfig,
): { event: Record<string, unknown>; errors: string[] } {
  const out: Record<string, unknown> = structuredClone(event)
  const errors: string[] = []

  if (cfg.field_mapping) {
    const v = getPath(out, cfg.field_mapping.from)
    setPath(out, cfg.field_mapping.to, v)
  }

  if (cfg.jsonata) {
    const v = evalJsonataLite(cfg.jsonata.expr, out)
    if (v === undefined) errors.push('jsonata_eval_failed')
    else setPath(out, cfg.jsonata.output, v)
  }

  if (cfg.regex) {
    const cur = getPath(out, cfg.regex.field)
    if (typeof cur === 'string') {
      const re = new RegExp(cfg.regex.pattern)
      if (re.test(cur)) {
        setPath(out, cfg.regex.field, cur.replace(re, cfg.regex.replace))
      }
    }
  }

  if (cfg.timestamp) {
    const raw = getPath(out, cfg.timestamp.field)
    const norm = normalizeTimestamp(raw, cfg.timestamp.mode)
    if (norm == null) errors.push('invalid_timestamp')
    else setPath(out, `${cfg.timestamp.field}_normalized`, norm)
  }

  return { event: out, errors }
}
