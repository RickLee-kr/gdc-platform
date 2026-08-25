import { GitBranch } from 'lucide-react'
import type { MarketplaceCapabilitiesRead } from '../../../api/gdcMarketplace'

export type MarketplaceGitInstallProps = {
  capabilities: MarketplaceCapabilitiesRead | null
}

export function MarketplaceGitInstall({ capabilities }: MarketplaceGitInstallProps) {
  const reason =
    capabilities?.git_acquisition_reason ?? 'Remote Git package acquisition is not implemented (M29.9).'

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="marketplace-git-install"
    >
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-slate-400" aria-hidden />
        <div>
          <p className="text-[12px] font-semibold text-slate-800 dark:text-gdc-foreground">Install from Git</p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="marketplace-git-install-reason">
            {reason}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={reason}
        data-testid="marketplace-git-install-button"
        className="inline-flex h-8 cursor-not-allowed items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-[12px] font-semibold text-slate-400 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-muted"
      >
        Install from Git
      </button>
    </div>
  )
}
