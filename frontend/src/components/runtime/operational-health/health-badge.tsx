import type { HealthFactor, HealthLevel } from '../../../api/types/gdcApi'
import { cn } from '../../../lib/utils'
import { formatHealthLevelLabel } from '../../../lib/operational-health-present'

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

const FALLBACK_TONE =
  'border-slate-300/70 bg-slate-50 text-slate-700 dark:border-slate-600/40 dark:bg-slate-900/30 dark:text-slate-200'

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
  const label = formatHealthLevelLabel(level)
  const tone = LEVEL_BADGE_TONE[level] ?? FALLBACK_TONE
  const title = factors ? buildFactorTooltip(factors) : label
  const ariaLabel = `Health ${label}${Number.isFinite(score) ? `, score ${score}` : ''}`
  return (
    <span
      title={title}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        tone,
        compact ? 'text-[10px]' : 'text-[11px]',
      )}
      data-health-level={level}
      data-health-label={label}
      data-health-score={score}
    >
      {label}
      <span aria-hidden className="font-mono opacity-70">
        · {score}
      </span>
    </span>
  )
}
