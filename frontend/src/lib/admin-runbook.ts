/** In-repo path shown when no hosted doc URL is configured at build time. */
export const BACKUP_RESTORE_RUNBOOK_REPO_PATH = 'docs/admin/backup-restore.md'

/** Optional full URL set at Vite build time for the admin runbook link. */
export function getBackupRestoreRunbookHref(): string | null {
  const raw = import.meta.env.VITE_ADMIN_BACKUP_RESTORE_RUNBOOK_URL
  if (typeof raw !== 'string') return null
  const u = raw.trim()
  return u.length > 0 ? u : null
}
