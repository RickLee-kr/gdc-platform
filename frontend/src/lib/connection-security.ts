/**
 * Resolve whether the operator's browser connection is encrypted.
 *
 * Combines the page protocol with the API's X-Forwarded-Proto–aware
 * `request_scheme` / `current_access_url` so reverse-proxy deployments are not
 * classified from `window.location.protocol` alone.
 */

export type ConnectionSecurityInput = {
  /** `window.location.protocol` e.g. `http:` / `https:` */
  pageProtocol: string
  /** Backend `current_access_url` (X-Forwarded-Proto aware). */
  currentAccessUrl?: string | null
  /** Backend `request_scheme`. */
  requestScheme?: 'http' | 'https' | 'unknown' | null
}

export type ConnectionSecurityResult = {
  secure: boolean
  /** Why we classified the connection this way (for tests / diagnostics). */
  source: 'page_https' | 'page_http' | 'request_scheme' | 'current_access_url' | 'default_secure'
}

function schemeFromUrl(url: string | null | undefined): 'http' | 'https' | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return 'https'
    if (parsed.protocol === 'http:') return 'http'
  } catch {
    if (url.startsWith('https://')) return 'https'
    if (url.startsWith('http://')) return 'http'
  }
  return null
}

export function resolveConnectionSecurity(input: ConnectionSecurityInput): ConnectionSecurityResult {
  // Browser HTTPS means the page (and credentials) are on TLS — never warn.
  if (input.pageProtocol === 'https:') {
    return { secure: true, source: 'page_https' }
  }

  // Browser HTTP is unencrypted for this session — warn.
  if (input.pageProtocol === 'http:') {
    return { secure: false, source: 'page_http' }
  }

  // Unusual page scheme: lean on reverse-proxy aware backend signals.
  if (input.requestScheme === 'https' || input.requestScheme === 'http') {
    return {
      secure: input.requestScheme === 'https',
      source: 'request_scheme',
    }
  }

  const fromAccess = schemeFromUrl(input.currentAccessUrl ?? null)
  if (fromAccess) {
    return { secure: fromAccess === 'https', source: 'current_access_url' }
  }

  return { secure: true, source: 'default_secure' }
}

export function shouldShowInsecureConnectionWarning(input: ConnectionSecurityInput): boolean {
  return !resolveConnectionSecurity(input).secure
}
