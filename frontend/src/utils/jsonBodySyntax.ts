/** Client-side JSON request-body validation before hitting `/runtime/api-test/http`. */

export type JsonSyntaxOk = { ok: true; value: unknown }
export type JsonSyntaxErr = { ok: false; message: string; line?: number; column?: number }

function estimateLineColumn(raw: string, positionZeroBased: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < raw.length && i < positionZeroBased; i += 1) {
    const ch = raw.charCodeAt(i)
    if (ch === 10) {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

/** Parses trimmed JSON object/array/value for onboarding bodies (optional blank allowed → undefined object sentinel handled by callers). */
export function validateJsonBodyForApi(raw: string): JsonSyntaxOk | JsonSyntaxErr {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true as const, value: undefined }

  try {
    const value = JSON.parse(trimmed) as unknown
    return { ok: true as const, value }
  } catch (e) {
    const fallbackMsg = 'Invalid JSON syntax in request body.'
    if (!(e instanceof SyntaxError)) {
      return { ok: false as const, message: fallbackMsg }
    }
    const syn = e as SyntaxError & { lineNumber?: number; columnNumber?: number }
    let posMatch = /position (\d+)/i.exec(String(e.message))
    let idx = posMatch ? Number(posMatch[1]) : NaN
    if (!Number.isFinite(idx)) {
      posMatch = /column (\d+)/i.exec(String(e.message))
      idx = posMatch ? Number(posMatch[1]) : NaN
    }
    if (!Number.isFinite(idx)) {
      const approxMatch = /\(evaluating '?(.*)'?\)/i.exec(String(e.message))
      const snippet = approxMatch?.[1]
      idx = snippet && trimmed.includes(snippet) ? trimmed.indexOf(snippet) : NaN
    }
    const lc =
      typeof syn.lineNumber === 'number' && syn.lineNumber > 0
        ? { line: syn.lineNumber, column: typeof syn.columnNumber === 'number' ? syn.columnNumber : 1 }
        : Number.isFinite(idx)
          ? estimateLineColumn(trimmed, idx)
          : undefined

    const detail = String(e.message || '').trim()
    const message =
      lc != null ? `${fallbackMsg} (${detail}) Line ${lc.line}, column ${lc.column}.` : `${fallbackMsg} ${detail || ''}`.trim()

    return { ok: false as const, message, line: lc?.line, column: lc?.column }
  }
}
