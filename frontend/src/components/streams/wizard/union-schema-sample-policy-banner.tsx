import { AlertTriangle } from 'lucide-react'
import { cn } from '../../../lib/utils'
import {
  getUnionSchemaSampleStatus,
  type UnionSchemaSamplePolicy,
} from '../../../utils/unionSchemaSamplePolicy'

export function UnionSchemaSamplePolicyBanner({
  policy,
  className,
}: {
  policy: UnionSchemaSamplePolicy
  className?: string
}) {
  if (policy.status === 'ready') return null

  const isNeedsAttention = policy.status === 'needs_attention'

  return (
    <div
      role="status"
      data-testid={`union-schema-sample-policy-${policy.status}`}
      className={cn(
        'flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-[11px]',
        isNeedsAttention
          ? 'border-amber-400/80 bg-amber-50 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100'
          : 'border-slate-300/80 bg-slate-50 text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{isNeedsAttention ? 'Needs Attention' : 'Warning'}</p>
        <p className="mt-0.5 leading-snug">{policy.message}</p>
        <p className="mt-1 text-[10px] opacity-80">
          Sample events: {policy.sampleCount} (minimum {10}, recommended {20})
        </p>
      </div>
    </div>
  )
}

export function unionSchemaSamplePolicyBannerFromCount(sampleCount: number): UnionSchemaSamplePolicy {
  return getUnionSchemaSampleStatus(sampleCount)
}
