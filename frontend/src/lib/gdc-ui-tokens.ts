/**
 * GDC dark theme surface tokens (shell, admin, modals).
 * Hierarchy: page (L0) < panel/section (L1) < card (L2) < elevated (L3).
 * Dark surfaces stay in the navy family — no white / light-gray panels.
 */
export const gdcUi = {
  cardShell:
    'rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card dark:shadow-gdc-card dark:ring-1 dark:ring-[rgba(120,150,220,0.08)]',
  innerWell:
    'rounded-lg border border-slate-100 bg-slate-50/40 dark:border-gdc-divider dark:bg-gdc-section dark:shadow-gdc-control',
  input:
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control dark:placeholder:text-gdc-placeholder dark:focus:border-gdc-primary dark:focus:ring-gdc-primary/45',
  select:
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control dark:focus:border-gdc-primary dark:focus:ring-gdc-primary/45',
  modalPanel:
    'w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-gdc-borderStrong dark:bg-gdc-elevated dark:shadow-gdc-elevated dark:ring-1 dark:ring-[rgba(120,150,220,0.1)]',
  primaryBtn: 'rounded-lg bg-gdc-primary px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50',
  secondaryBtn:
    'rounded-lg border border-gdc-primary/50 bg-white px-3 py-1.5 text-[12px] font-semibold text-gdc-primary shadow-sm hover:bg-violet-50 dark:border-gdc-primary/45 dark:bg-gdc-card dark:text-violet-200 dark:shadow-gdc-control dark:hover:bg-gdc-cardHover',
  textMuted: 'text-slate-600 dark:text-gdc-muted',
  textTitle: 'text-slate-900 dark:text-gdc-foreground',
  /** Empty / zero-data panels */
  emptyPanel:
    'rounded-xl border border-dashed border-slate-200/90 bg-slate-50/60 px-5 py-8 text-center dark:border-gdc-border dark:bg-gdc-section dark:shadow-gdc-control',
} as const

/**
 * Effective role for the UI session.
 *
 * After spec 020 the source of truth is the JWT in `gdc_platform_session_v1`.
 * The legacy `gdc_platform_ui_role` localStorage key is consulted only as a
 * fallback for transient renders / older bundles — the server enforces role
 * via the bearer token regardless of what the UI displays.
 */
import { getSessionRole, getSessionUsername, clearSession } from '../auth/session'

export function readAdminUiRole(): 'ADMINISTRATOR' | 'OPERATOR' | 'VIEWER' | null {
  const fromSession = getSessionRole()
  if (fromSession) return fromSession
  try {
    const v = globalThis.localStorage?.getItem('gdc_platform_ui_role')?.trim().toUpperCase()
    if (v === 'VIEWER' || v === 'OPERATOR' || v === 'ADMINISTRATOR') return v
  } catch {
    /* ignore */
  }
  return null
}

export function readAdminUiUsername(): string | null {
  return getSessionUsername()
}

/** Kept for legacy callers; the JWT session is the real source of truth. */
export function persistAdminUiRole(role: 'ADMINISTRATOR' | 'OPERATOR' | 'VIEWER' | null, username?: string): void {
  try {
    if (role) {
      globalThis.localStorage?.setItem('gdc_platform_ui_role', role)
    } else {
      globalThis.localStorage?.removeItem('gdc_platform_ui_role')
    }
    if (username) {
      globalThis.localStorage?.setItem('gdc_platform_ui_username', username)
    }
  } catch {
    /* ignore */
  }
}

export function clearAdminUiSession(): void {
  clearSession()
}

export function isAdminUiReadOnly(): boolean {
  return readAdminUiRole() === 'VIEWER'
}

export function isAdminUiOperator(): boolean {
  return readAdminUiRole() === 'OPERATOR'
}
