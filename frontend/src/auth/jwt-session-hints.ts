/** Best-effort JWT payload decode for SPA session hints (not verified; server is authoritative). */

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    const parsed = JSON.parse(json) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** True when the access token carries the must-change-password claim (`mcp`). */
export function accessTokenRequiresPasswordChange(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false
  const payload = decodeJwtPayload(accessToken)
  if (!payload) return false
  const mcp = payload.mcp
  return mcp === 1 || mcp === true || mcp === '1'
}
