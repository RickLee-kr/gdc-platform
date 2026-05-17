import type { WhoAmIDto } from '../api/gdcAdmin'
import { persistSession, readSession } from './session'

export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED'

/** Thrown by {@link requestJson} when the API requires a password change before other work. */
export class PasswordChangeRequiredError extends Error {
  readonly code = PASSWORD_CHANGE_REQUIRED_CODE

  constructor(message = 'You must change your password before using this resource.') {
    super(message)
    this.name = 'PasswordChangeRequiredError'
  }
}

export function extractHttpErrorCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const o = body as Record<string, unknown>
  const detail = o.detail
  if (typeof detail === 'string') return null
  if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>
    if (typeof d.error_code === 'string') return d.error_code
  }
  if (typeof o.error_code === 'string') return o.error_code
  return null
}

export function isPasswordChangeRequiredCode(code: string | null | undefined): boolean {
  return code === PASSWORD_CHANGE_REQUIRED_CODE
}

export function errorIndicatesPasswordChangeRequired(err: unknown): boolean {
  if (err instanceof PasswordChangeRequiredError) return true
  if (err instanceof Error) {
    return (
      err.message.includes(`[${PASSWORD_CHANGE_REQUIRED_CODE}]`) ||
      /PASSWORD_CHANGE_REQUIRED/i.test(err.message)
    )
  }
  return false
}

/** Persist the forced password-change gate without clearing JWTs. */
export function markSessionRequiresPasswordChange(): void {
  const s = readSession()
  if (!s) return
  persistSession({
    ...s,
    user: {
      ...s.user,
      must_change_password: true,
    },
  })
}

/** Apply a successful GET /auth/whoami (session "me") payload to local storage. */
export function syncSessionFromWhoAmI(who: WhoAmIDto): void {
  const s = readSession()
  if (!s) return
  const user = {
    ...s.user,
    username: who.username || s.user.username,
    role: who.role ?? s.user.role,
    status: s.user.status,
    ...(who.capabilities ? { capabilities: who.capabilities } : {}),
  }
  if (who.must_change_password === true) {
    user.must_change_password = true
  } else {
    delete user.must_change_password
  }
  persistSession({
    ...s,
    ...(who.token_expires_at ? { expires_at: who.token_expires_at } : {}),
    user,
  })
}

/** Hide generic API failure banners while the password-change gate is active. */
export function shouldSuppressApiLoadError(err: unknown): boolean {
  return errorIndicatesPasswordChangeRequired(err) || readSession()?.user.must_change_password === true
}
