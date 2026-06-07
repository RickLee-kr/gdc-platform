import { ShieldAlert } from 'lucide-react'
import { governanceReadOnlyReason } from '../../lib/governance-rbac'

/** M20 — read-only banner when the signed-in role can view but not mutate Governance. */
export function PersonaReadOnlyBanner() {
  const reason = governanceReadOnlyReason()
  if (!reason) return null

  return (
    <div
      role="status"
      data-testid="governance-read-only-banner"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-500/[0.08] px-4 py-3 text-[12px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex min-w-0 items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        <p>
          <span className="font-semibold">Read-only view.</span> {reason}
        </p>
      </div>
    </div>
  )
}
