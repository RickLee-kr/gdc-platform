import type { HealthFactor, HealthLevel } from '../../../api/types/gdcApi'
import { cn } from '../../../lib/utils'

const LEVEL_BADGE_TONE: Record<HealthLevel, string> = {
  HEALTHY:
    'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/30 dark:text-emerald-200',
  DEGRADED:
    'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-100',
  UNHEALTHY:
    'border-orange-300/70 bg-orange-50 text-orange-700 dark:border-orange-700/40 dark:bg-orange-900/30 dark:text-orange-100',
  CRITICAL:
    'border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/30 dark:text-rose-100',
}

function buildFactorTooltip(factors: HealthFactor[]): string {
  if (factors.length === 0) return 'No penalties applied (baseline 100).'
  return factors.map((f) => `${f.label} (${f.delta})${f.detail ? ` — ${f.detail}` : ''}`).join('\n')
}

export function HealthBadge({
  level,
  score,
  factors,
  compact,
}: {
  level: HealthLevel
  score: number
  factors?: HealthFactor[]
  compact?: boolean
}) {
  const tone = LEVEL_BADGE_TONE[level]
  const title = factors ? buildFactorTooltip(factors) : undefined
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        tone,
        compact ? 'text-[10px]' : 'text-[11px]',
      )}
      data-health-level={level}
      data-health-score={score}
    >
      {level}
      <span aria-hidden className="font-mono opacity-70">
        · {score}
      </span>
    </span>
  )
}
