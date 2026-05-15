const DEFAULT_DATARELAY_INSTANCE_LABEL = 'datarelay-instance'

/**
 * Sidebar instance label (build-time `VITE_DATARELAY_INSTANCE_LABEL`).
 * Whitespace-only values fall back to the default.
 */
export function getDatarelayInstanceLabel(): string {
  const raw = import.meta.env.VITE_DATARELAY_INSTANCE_LABEL
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed) return trimmed
  }
  return DEFAULT_DATARELAY_INSTANCE_LABEL
}
