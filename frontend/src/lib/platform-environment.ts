/** Canonical deployment environment label from `/admin/system` `app_env`. */

export type PlatformEnvTier = 'development' | 'staging' | 'production' | 'test' | 'unknown'

export function normalizeAppEnv(raw: string | null | undefined): string {
  return (raw ?? '').trim()
}

export function classifyAppEnvTier(raw: string | null | undefined): PlatformEnvTier {
  const v = normalizeAppEnv(raw).toLowerCase()
  if (!v) return 'unknown'
  if (v === 'prod' || v === 'production') return 'production'
  if (v === 'stage' || v === 'staging') return 'staging'
  if (v === 'dev' || v === 'development' || v === 'local') return 'development'
  if (v === 'test' || v === 'testing' || v === 'ci') return 'test'
  return 'unknown'
}

/** Operator-facing label; title-cases known tiers, otherwise shows raw app_env. */
export function formatAppEnvLabel(raw: string | null | undefined): string {
  const normalized = normalizeAppEnv(raw)
  if (!normalized) return 'Unknown environment'
  switch (classifyAppEnvTier(normalized)) {
    case 'production':
      return 'Production'
    case 'staging':
      return 'Staging'
    case 'development':
      return 'Development'
    case 'test':
      return 'Test'
    default:
      return normalized
  }
}

export function appEnvDotClass(raw: string | null | undefined): string {
  switch (classifyAppEnvTier(raw)) {
    case 'production':
      return 'bg-emerald-500'
    case 'staging':
      return 'bg-amber-500'
    case 'development':
      return 'bg-sky-500'
    case 'test':
      return 'bg-violet-500'
    default:
      return 'bg-slate-400'
  }
}
