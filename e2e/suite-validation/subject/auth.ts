/**
 * Suite-validation subject: source authentication contract.
 * Intentionally independent from app/runtime product code.
 */

export type AuthRequest = {
  auth_type: string
  headers: Record<string, string>
  query: Record<string, string>
  credentials?: Record<string, string>
}

export type AuthResult = {
  ok: boolean
  status: number
  reason?: string
}

const EXPECTED = {
  bearer_token: 'golden-bearer-token-001',
  basic_user: 'golden_user',
  basic_pass: 'golden_pass',
  api_key_header_name: 'X-API-Key',
  api_key_value: 'golden-api-key-001',
  api_key_query_name: 'api_key',
  webhook_secret: 'golden-webhook-secret',
  pg_user: 'golden_pg',
  pg_pass: 'golden_pg_pass',
  s3_key: 'AKIA_GOLDEN',
  s3_secret: 'golden_s3_secret',
  sftp_user: 'golden_sftp',
  sftp_pass: 'golden_sftp_pass',
} as const

export function authenticateSource(req: AuthRequest): AuthResult {
  switch (req.auth_type) {
    case 'no_auth':
      return { ok: true, status: 200 }
    case 'basic': {
      const h = req.headers.authorization || req.headers.Authorization || ''
      const expected = `Basic ${Buffer.from(`${EXPECTED.basic_user}:${EXPECTED.basic_pass}`).toString('base64')}`
      if (h !== expected) return { ok: false, status: 401, reason: 'basic_auth_failed' }
      return { ok: true, status: 200 }
    }
    case 'bearer': {
      const h = req.headers.authorization || req.headers.Authorization || ''
      if (h !== `Bearer ${EXPECTED.bearer_token}`) {
        return { ok: false, status: 401, reason: 'bearer_auth_failed' }
      }
      return { ok: true, status: 200 }
    }
    case 'api_key_header': {
      const key = req.headers[EXPECTED.api_key_header_name] || req.headers['x-api-key']
      if (key !== EXPECTED.api_key_value) return { ok: false, status: 403, reason: 'api_key_header_failed' }
      return { ok: true, status: 200 }
    }
    case 'api_key_query': {
      const key = req.query[EXPECTED.api_key_query_name]
      if (key !== EXPECTED.api_key_value) return { ok: false, status: 403, reason: 'api_key_query_failed' }
      return { ok: true, status: 200 }
    }
    case 'postgresql': {
      const user = req.credentials?.user
      const pass = req.credentials?.password
      if (user !== EXPECTED.pg_user || pass !== EXPECTED.pg_pass) {
        return { ok: false, status: 401, reason: 'pg_credential_failed' }
      }
      return { ok: true, status: 200 }
    }
    case 's3': {
      const key = req.credentials?.access_key
      const secret = req.credentials?.secret_key
      if (key !== EXPECTED.s3_key || secret !== EXPECTED.s3_secret) {
        return { ok: false, status: 403, reason: 's3_credential_failed' }
      }
      return { ok: true, status: 200 }
    }
    case 'sftp': {
      const user = req.credentials?.user
      const pass = req.credentials?.password
      const key = req.credentials?.ssh_key
      if (user === EXPECTED.sftp_user && (pass === EXPECTED.sftp_pass || key === 'golden-ssh-key')) {
        return { ok: true, status: 200 }
      }
      return { ok: false, status: 401, reason: 'sftp_auth_failed' }
    }
    case 'webhook_receiver': {
      const secret = req.headers['X-Webhook-Secret'] || req.headers['x-webhook-secret']
      if (secret !== EXPECTED.webhook_secret) {
        return { ok: false, status: 401, reason: 'webhook_auth_failed' }
      }
      return { ok: true, status: 200 }
    }
    default:
      return { ok: false, status: 400, reason: 'unknown_auth_type' }
  }
}

/** Treat 401/403 as hard failures (mutation M03 targets this). */
export function sourceFetchOutcome(auth: AuthResult): 'success' | 'auth_error' {
  if (!auth.ok && (auth.status === 401 || auth.status === 403)) return 'auth_error'
  return auth.ok ? 'success' : 'auth_error'
}

export const AUTH_EXPECTED = EXPECTED
