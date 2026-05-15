/**
 * RBAC-lite helpers for the SPA — mirrors server rules in `app/auth/route_access.py`.
 * Prefer `user.capabilities` from the login / whoami payload when present.
 */

import { useEffect, useState } from 'react'

import { onSessionChange, readSession, type SessionRole } from '../auth/session'

function deriveCapabilities(role: SessionRole | null): Record<string, boolean> {
  // Unauthenticated SPA renders (e.g. tests, dev without session): mirror anonymous-administrator affordances.
  if (role == null) {
    return deriveCapabilities('ADMINISTRATOR')
  }
  const isAdmin = role === 'ADMINISTRATOR'
  const isOp = role === 'OPERATOR'
  const isViewer = role === 'VIEWER'
  const canOperate = isAdmin || isOp
  return {
    workspace_mutations: canOperate,
    runtime_stream_control: canOperate,
    runtime_logs_cleanup: canOperate,
    backfill_mutations: canOperate,
    retention_execute: canOperate,
    validation_mutations: canOperate,
    backup_import_apply: isAdmin,
    backup_import_preview: canOperate,
    backup_clone: canOperate,
    admin_user_management: isAdmin,
    admin_password_changes: isAdmin,
    admin_maintenance_health: isAdmin,
    admin_support_bundle: isAdmin,
    admin_https_write: isAdmin,
    admin_retention_policy_write: isAdmin,
    admin_alert_settings_write: isAdmin,
    admin_config_snapshot_apply: isAdmin,
    administration_apis: canOperate,
    read_only_monitoring: isAdmin || isOp || isViewer,
  }
}

/** Effective capability map for the signed-in session (JWT + optional server flags). */
export function getSessionCapabilities(): Record<string, boolean> {
  const s = readSession()
  const role = s?.user.role ?? null
  const base = deriveCapabilities(role)
  const fromServer = s?.user.capabilities
  if (fromServer && typeof fromServer === 'object') {
    return { ...base, ...fromServer }
  }
  return base
}

/** Subscribes to session changes so capability-driven UI updates after login/logout. */
export function useSessionCapabilities(): Record<string, boolean> {
  const [caps, setCaps] = useState(() => getSessionCapabilities())
  useEffect(() => {
    return onSessionChange(() => {
      setCaps(getSessionCapabilities())
    })
  }, [])
  return caps
}
