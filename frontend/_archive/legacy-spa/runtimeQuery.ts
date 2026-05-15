/** Build query string; omits undefined, null, and empty string. */
export function runtimeQuery(path: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') {
      continue
    }
    sp.set(k, String(v))
  }
  const q = sp.toString()
  return q ? `${path}?${q}` : path
}
