/** Parse segments after `$` for paths like `data.items`, `data.items[0].id`. */
export function parseJsonPathSegments(expr: string): string[] {
  const trimmed = expr.trim()
  const body = trimmed === '$' ? '' : trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed.replace(/^\$\.?/, '')
  if (!body) return []
  const segments: string[] = []
  let i = 0
  let acc = ''
  while (i < body.length) {
    const c = body[i]
    if (c === '.') {
      if (acc) segments.push(acc)
      acc = ''
      i += 1
      continue
    }
    if (c === '[') {
      if (acc) segments.push(acc)
      acc = ''
      const j = body.indexOf(']', i)
      if (j === -1) break
      segments.push(body.slice(i + 1, j))
      i = j + 1
      continue
    }
    acc += c
    i += 1
  }
  if (acc) segments.push(acc)
  return segments
}

/** Minimal JSONPath-style resolver for API test UI (dots + `[n]` indices). */
export function resolveJsonPath(root: unknown, expr: string): unknown {
  const t = expr.trim()
  if (t === '' || t === '$') return root
  const segments = parseJsonPathSegments(t.startsWith('$') ? t : `$.${t}`)
  let cur: unknown = root
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined
    if (/^\d+$/.test(seg)) {
      if (!Array.isArray(cur)) return undefined
      cur = cur[Number(seg)]
      continue
    }
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function countLeafKeys(obj: unknown): number {
  if (obj === null || typeof obj !== 'object') return 0
  if (Array.isArray(obj)) return obj.length ? countLeafKeys(obj[0]) : 0
  let n = 0
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      n += countLeafKeys(v)
    } else {
      n += 1
    }
  }
  return n
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
