/**
 * Tenant-level governance mode flag (frontend-only until backend RBAC).
 * M17.4: derived from UI persona — governance persona enables Data Policy wizard step and governance surfaces.
 */

import { isGovernancePersona } from './persona-mode'

export type GovernanceMode = 'off' | 'enabled'

/** @deprecated M17.4 — use persona mode via isGovernancePersona(). */
const LEGACY_STORAGE_KEY = 'gdc-platform-governance-mode'

export function readGovernanceMode(): GovernanceMode {
  if (isGovernancePersona()) return 'enabled'
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw === 'enabled' || raw === 'true' || raw === 'on') return 'enabled'
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_GOVERNANCE_MODE
  if (env === 'enabled' || env === 'true' || env === 'on') return 'enabled'
  return 'off'
}

export function isGovernanceModeEnabled(): boolean {
  return readGovernanceMode() === 'enabled'
}
